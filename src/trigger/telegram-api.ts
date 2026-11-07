// Thin wrappers over the Telegram Bot API. The bot token lives only in request URLs built here,
// never in anything stored with the conversation
const apiUrl = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

const callApi = async <T>(method: string, body: FormData | Record<string, unknown>) => {
  const res = await fetch(
    apiUrl(method),
    body instanceof FormData
      ? { method: "POST", body }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
  );
  if (!res.ok) {
    throw new Error(`${method} failed: ${res.status} ${await res.text()}`);
  }
  const { result } = (await res.json()) as { result: T };
  return result;
};

export const sendMessage = async (chatId: number, text: string) => {
  const { message_id } = await callApi<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
  });
  return message_id;
};

// Bots can download files up to 20 MB and upload documents up to 50 MB, photos up to 10 MB
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const downloadFile = async (fileId: string) => {
  // file_path links expire after an hour, so resolve the permanent file_id on every download
  const { file_path } = await callApi<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file_path) {
    throw new Error("getFile returned no file_path");
  }
  const res = await fetch(
    `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file_path}`
  );
  if (!res.ok) {
    throw new Error(`File download failed: ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

export type OutgoingFile = { data: Uint8Array; filename: string; mediaType: string };

// Images go out as photos so they show inline; everything else as a document, byte for byte
export const sendFile = async (chatId: number, file: OutgoingFile, caption?: string) => {
  const asPhoto = PHOTO_TYPES.has(file.mediaType) && file.data.byteLength <= MAX_PHOTO_BYTES;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    asPhoto ? "photo" : "document",
    new Blob([file.data as Uint8Array<ArrayBuffer>], { type: file.mediaType }),
    file.filename
  );
  if (caption) {
    form.append("caption", caption);
  }
  const { message_id } = await callApi<{ message_id: number }>(
    asPhoto ? "sendPhoto" : "sendDocument",
    form
  );
  return message_id;
};
