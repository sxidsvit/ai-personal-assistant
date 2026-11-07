import { logger, task, wait } from "@trigger.dev/sdk";

export const helloWorldTask = task({
  id: "hello-world",
  maxDuration: 60,
  run: async (payload: { name?: string }) => {
    logger.log("Hello, world!", { payload });

    await wait.for({ seconds: 5 });

    return { message: `Hello, ${payload.name ?? "world"}!` };
  },
});
