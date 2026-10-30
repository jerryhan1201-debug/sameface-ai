import { handleRetouchRequest } from "./shared";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleRetouchRequest(request, {
    requiresRefinementInstruction: false,
    resultId: "openai-1",
    resultName: "First generated result",
    resultFinish: "OpenAI image edit",
  });
}
