import { neon } from "@neon/ai-sdk-provider";

type NeonModel = ReturnType<typeof neon>;
type CallOptions = Parameters<NeonModel["doStream"]>[0];

// AI SDK 7 hands tool-result images to v3 providers as `file-data`, which the Anthropic provider
// behind the Neon gateway drops with a warning: it only reads images as `image-data`. Convert them
// back so screenshots and viewed images reach the model. PDFs already work as `file-data`
const withToolResultImages = (options: CallOptions): CallOptions => ({
  ...options,
  prompt: options.prompt.map((message) =>
    message.role !== "tool"
      ? message
      : {
          ...message,
          content: message.content.map((part) =>
            part.type !== "tool-result" || part.output.type !== "content"
              ? part
              : {
                  ...part,
                  output: {
                    ...part.output,
                    value: part.output.value.map((item) =>
                      item.type === "file-data" && item.mediaType.startsWith("image/")
                        ? { type: "image-data" as const, data: item.data, mediaType: item.mediaType }
                        : item
                    ),
                  },
                }
          ),
        }
  ),
});

export const chatModel = (modelId: string): NeonModel => {
  const model = neon(modelId);
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    get supportedUrls() {
      return model.supportedUrls;
    },
    doGenerate: (options) => model.doGenerate(withToolResultImages(options)),
    doStream: (options) => model.doStream(withToolResultImages(options)),
  };
};
