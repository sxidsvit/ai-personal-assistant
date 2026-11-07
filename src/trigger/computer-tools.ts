import { posix } from "node:path";
import {
  Daytona,
  DaytonaNotFoundError,
  DaytonaProcessExecutionTimeoutError,
  type Sandbox,
} from "@daytona/sdk";
import { chat, type ChannelRunSurface } from "@trigger.dev/sdk/ai";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { log } from "./log.js";

// What a chat channel provides through its surface() for these tools to work
export type ComputerSurface = {
  // One sandbox per conversation, reused across turns
  sandboxName: string;
  maxSendBytes: number;
  loadAttachment: (attachmentId: string) => Promise<Uint8Array>;
  sendFile: (
    file: { data: Uint8Array; filename: string; mediaType: string },
    caption?: string
  ) => Promise<void>;
};

// A tool call the model got wrong (a directory instead of a file, a missing coordinate, a file too
// big to send). The model sees the message and corrects itself, so it isn't reported to Sentry as
// an error (see init.ts); failures of the sandbox or chat platforms still are
export class ToolInputError extends Error {
  override name = "ToolInputError";
}

const HOME = "/home/daytona";
const MAX_OUTPUT_CHARS = 20_000;
// Anthropic caps inline images at 5 MB once base64 encoded
const MAX_VIEW_BYTES = 3_750_000;

const MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".zip": "application/zip",
};
const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

const mediaTypeOf = (path: string) =>
  MEDIA_TYPES[posix.extname(path).toLowerCase()] ?? "application/octet-stream";

const resolvePath = (path: string) => posix.resolve(HOME, path);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Reads DAYTONA_API_KEY on first use, so task indexing works without it
let daytona: Daytona | undefined;
const client = () => (daytona ??= new Daytona());

const currentSurface = () => {
  const surface = chat.surface<ChannelRunSurface<ComputerSurface>>();
  if (!surface?.sandboxName) {
    throw new ToolInputError("The computer is only available inside a chat.");
  }
  return surface;
};

const STARTING_STATES = new Set(["creating", "starting", "restoring", "resuming"]);

const readySandbox = async (name: string) => {
  let sandbox: Sandbox;
  try {
    sandbox = await client().get(name);
  } catch (error) {
    if (!(error instanceof DaytonaNotFoundError)) throw error;
    // A new sandbox per user is the main Daytona cost driver; also marks a user's first use or a
    // return after the week-long auto-delete
    log.info("Sandbox created", { "sandbox.previous_state": "none" });
    return client().create({
      name,
      labels: { app: "personal-assistant" },
      // Stopped after 15 idle minutes (the default); archive after a day to free disk quota, then
      // delete after a week so abandoned chats don't pile up
      autoArchiveInterval: 24 * 60,
      autoDeleteInterval: 7 * 24 * 60,
    });
  }
  if (STARTING_STATES.has(sandbox.state ?? "")) {
    await sandbox.waitUntilStarted(180);
  } else if (sandbox.state !== "started") {
    // Restoring an archived sandbox takes longer than waking a stopped one: the previous state
    // explains a slow first tool call in a turn
    const previousState = sandbox.state;
    const startedAt = Date.now();
    await sandbox.start(180);
    log.info("Sandbox started", {
      "sandbox.previous_state": previousState,
      "sandbox.start_ms": Date.now() - startedAt,
    });
  }
  return sandbox;
};

// Parallel tool calls in one step share a lookup instead of racing to create the same sandbox.
// Each new call checks again, since the sandbox may have stopped between turns
const pending = new Map<string, Promise<Sandbox>>();

const getSandbox = (name: string) => {
  let sandbox = pending.get(name);
  if (!sandbox) {
    sandbox = readySandbox(name).finally(() => pending.delete(name));
    pending.set(name, sandbox);
  }
  return sandbox;
};

// Screenshots and viewed files stay out of the stored transcript: execute keeps the bytes here by
// tool call id and toModelOutput inlines them, so only the newest few reach the model and older
// ones (including every one from earlier turns once the run restarts) become a short note
const MAX_INLINE_FILES = 3;
type ModelOutput = Awaited<ReturnType<NonNullable<Tool["toModelOutput"]>>>;
const inlineFiles = new Map<string, { mediaType: string; data: string }>();

const keepInline = (toolCallId: string, file: { mediaType: string; data: string }) => {
  inlineFiles.set(toolCallId, file);
  for (const id of inlineFiles.keys()) {
    if (inlineFiles.size <= MAX_INLINE_FILES) break;
    inlineFiles.delete(id);
  }
};

const inlineFileOutput = ({
  toolCallId,
  output,
}: {
  toolCallId: string;
  output: unknown;
}): ModelOutput => {
  const text = JSON.stringify(output);
  const file = inlineFiles.get(toolCallId);
  return file
    ? {
        type: "content",
        value: [
          { type: "text", text },
          { type: "file", mediaType: file.mediaType, data: { type: "data", data: file.data } },
        ],
      }
    : {
        type: "text",
        value: `${text}\n[No longer shown. Take a new screenshot or view the file again if you need it.]`,
      };
};

const truncate = (text: string) =>
  text.length > MAX_OUTPUT_CHARS
    ? `[earlier output truncated]\n${text.slice(-MAX_OUTPUT_CHARS)}`
    : text;

// executeCommand runs the string without a shell; wrap it so pipes, redirects and heredocs work
const bash = (command: string) => `bash -c '${command.replaceAll("'", `'\\''`)}'`;

const runCommand = tool({
  description:
    "Run a bash command on your Linux computer and get its exit code and combined stdout/stderr. The working directory is /home/daytona.",
  inputSchema: z.object({
    command: z.string().describe("A bash command or script"),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(600)
      .optional()
      .describe("Defaults to 120. For longer jobs, start them in the background and poll"),
  }),
  execute: async ({ command, timeoutSeconds = 120 }) => {
    const sandbox = await getSandbox(currentSurface().sandboxName);
    try {
      const { exitCode, result } = await sandbox.process.executeCommand(
        bash(command),
        HOME,
        undefined,
        timeoutSeconds
      );
      return { exitCode, output: truncate(result) };
    } catch (error) {
      if (!(error instanceof DaytonaProcessExecutionTimeoutError)) throw error;
      // The command itself isn't logged: it can carry the user's data
      log.warn("Sandbox command timed out", { "sandbox.timeout_s": timeoutSeconds });
      return { exitCode: null, output: `Timed out after ${timeoutSeconds} seconds.` };
    }
  },
});

const loadAttachment = tool({
  description:
    "Copy a file the user sent in the chat onto your computer, into /home/daytona/inbox. Returns its path.",
  inputSchema: z.object({
    attachmentId: z.string().describe("The attachment id shown next to the file in the chat"),
    filename: z.string().describe("The file's name as shown in the chat"),
  }),
  execute: async ({ attachmentId, filename }) => {
    const surface = currentSurface();
    const [sandbox, data] = await Promise.all([
      getSandbox(surface.sandboxName),
      surface.loadAttachment(attachmentId),
    ]);
    const path = posix.join(HOME, "inbox", posix.basename(filename) || "attachment");
    await sandbox.fs.uploadFile(Buffer.from(data), path);
    return { path, bytes: data.byteLength };
  },
});

const sendFile = tool({
  description:
    "Send a file from your computer to the user in the chat. Images are shown inline; everything else arrives as a downloadable file.",
  inputSchema: z.object({
    path: z.string().describe("Path of the file on your computer"),
    caption: z.string().max(1024).optional().describe("Optional short caption shown with the file"),
  }),
  execute: async ({ path, caption }) => {
    const surface = currentSurface();
    const sandbox = await getSandbox(surface.sandboxName);
    const fullPath = resolvePath(path);
    const { size, isDir } = await sandbox.fs.getFileDetails(fullPath);
    if (isDir) {
      throw new ToolInputError(`${fullPath} is a directory. Zip it first.`);
    }
    if (size > surface.maxSendBytes) {
      throw new ToolInputError(`${fullPath} is ${size} bytes; the chat accepts at most ${surface.maxSendBytes}.`);
    }
    const data = await sandbox.fs.downloadFile(fullPath);
    const filename = posix.basename(fullPath);
    await surface.sendFile({ data, filename, mediaType: mediaTypeOf(fullPath) }, caption);
    return { sent: filename, bytes: size };
  },
});

const viewFile = tool({
  description:
    "Look at an image (PNG, JPEG, GIF, WebP) or PDF on your computer, for example to check a file you made before sending it.",
  inputSchema: z.object({
    path: z.string().describe("Path of the file on your computer"),
  }),
  execute: async ({ path }, { toolCallId }) => {
    const sandbox = await getSandbox(currentSurface().sandboxName);
    const fullPath = resolvePath(path);
    const mediaType = mediaTypeOf(fullPath);
    if (!VIEWABLE.has(mediaType)) {
      throw new ToolInputError("Only PNG, JPEG, GIF, WebP and PDF files can be viewed. Convert it first.");
    }
    const { size } = await sandbox.fs.getFileDetails(fullPath);
    if (size > MAX_VIEW_BYTES) {
      throw new ToolInputError(`${fullPath} is ${size} bytes; shrink it below ${MAX_VIEW_BYTES} first.`);
    }
    const data = await sandbox.fs.downloadFile(fullPath);
    keepInline(toolCallId, { mediaType, data: data.toString("base64") });
    return { path: fullPath, mediaType, bytes: size };
  },
  toModelOutput: inlineFileOutput,
});

const DESKTOP_ACTIONS = [
  "screenshot",
  "click",
  "double_click",
  "right_click",
  "move",
  "drag",
  "scroll",
  "type",
  "key",
] as const;

const computer = tool({
  description:
    "Operate your computer's graphical desktop (1024x768 pixels). Every action returns a fresh screenshot. Coordinates are pixels from the top-left corner of the screenshot.",
  inputSchema: z.object({
    action: z.enum(DESKTOP_ACTIONS),
    x: z.number().int().optional().describe("Target for click, double_click, right_click, move and scroll; start of drag"),
    y: z.number().int().optional(),
    toX: z.number().int().optional().describe("End of drag"),
    toY: z.number().int().optional(),
    text: z.string().optional().describe("Text to type"),
    keys: z.string().optional().describe('Key or combination for key, e.g. "enter", "ctrl+l", "alt+tab"'),
    direction: z.enum(["up", "down"]).optional().describe("Scroll direction"),
    amount: z.number().int().min(1).max(20).optional().describe("Scroll wheel ticks, default 3"),
  }),
  execute: async (input, { toolCallId }) => {
    const sandbox = await getSandbox(currentSurface().sandboxName);
    const desktop = sandbox.computerUse;
    // The desktop isn't running after the sandbox (re)starts; it takes a moment to draw
    if ((await desktop.getStatus()).status !== "active") {
      await desktop.start();
      await sleep(2000);
    }

    const at = () => {
      if (input.x === undefined || input.y === undefined) {
        throw new ToolInputError(`${input.action} needs x and y.`);
      }
      return [input.x, input.y] as const;
    };

    switch (input.action) {
      case "screenshot":
        break;
      case "click":
        await desktop.mouse.click(...at());
        break;
      case "double_click":
        await desktop.mouse.click(...at(), "left", true);
        break;
      case "right_click":
        await desktop.mouse.click(...at(), "right");
        break;
      case "move":
        await desktop.mouse.move(...at());
        break;
      case "drag":
        if (input.toX === undefined || input.toY === undefined) {
          throw new ToolInputError("drag needs toX and toY.");
        }
        await desktop.mouse.drag(...at(), input.toX, input.toY);
        break;
      case "scroll":
        await desktop.mouse.scroll(...at(), input.direction ?? "down", input.amount ?? 3);
        break;
      case "type":
        if (!input.text) throw new ToolInputError("type needs text.");
        await desktop.keyboard.type(input.text);
        break;
      case "key":
        if (!input.keys) throw new ToolInputError("key needs keys.");
        await (input.keys.includes("+")
          ? desktop.keyboard.hotkey(input.keys)
          : desktop.keyboard.press(input.keys));
        break;
    }

    // Let the UI react before capturing it
    if (input.action !== "screenshot") await sleep(1000);
    const { screenshot, cursorPosition } = await desktop.screenshot.takeCompressed({
      format: "jpeg",
      quality: 60,
    });
    if (!screenshot) throw new Error("The screenshot came back empty.");
    keepInline(toolCallId, { mediaType: "image/jpeg", data: screenshot });
    return { action: input.action, cursor: cursorPosition };
  },
  toModelOutput: inlineFileOutput,
});

// Neutral names so the model never echoes vendor names back to the user
export const computerTools = { runCommand, loadAttachment, sendFile, viewFile, computer };

export const computerToolsInstructions = `
## Your computer

You have your own Linux computer for this conversation. Use it on your own initiative whenever a task needs files, code or apps: editing, filling in, signing, converting or merging documents; making spreadsheets, charts, images or PDFs; crunching data the user sent; or operating a website that needs clicks, forms or logins. Its files stay between messages, but it is wiped after a week without use.

Files the user sends show up in their message with an attachment id. You can read images and PDFs directly in the message. To work on any attached file, copy it onto the computer with loadAttachment first.

How to work:
1. Prefer runCommand with scripts over the desktop. Python 3 with pypdf and Pillow is installed; pip install anything else you need (for example reportlab or pymupdf). Write scripts to files with heredocs and run them.
2. Check your output before sending it. For a document, render the pages you changed to PNG (pymupdf works well) and look at them with viewFile.
3. Deliver files with sendFile, using a clear filename such as rental-agreement-signed.pdf. sendFile is the only way to give the user a file: never claim a file is attached unless sendFile succeeded, and don't paste a file's raw contents into the chat instead.
4. Use the computer tool only when a task needs a graphical app or a website you must click through. Start apps from runCommand in the background, for example: DISPLAY=:0 nohup chromium --no-sandbox --no-first-run URL >/dev/null 2>&1 &
5. For jobs over a couple of minutes, run them in the background with nohup and check on them.
6. If you can't load the user's file or can't send yours, stop and tell the user. Never recreate their document from its text as a substitute: a rebuilt copy can differ from the original in ways they won't notice.

When you're done, reply with one or two short lines about what you did. The file itself is already in the chat.

Never mention your tools, the computer's vendor, sandboxes or file paths unless the user asks. To the user you simply made or edited the file.
`.trim();
