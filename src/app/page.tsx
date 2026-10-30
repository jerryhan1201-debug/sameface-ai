"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

import {
  compileRetouchPrompt,
  DEFAULT_RETOUCH_PARAMS,
  type EditArea,
  type MaskSettings,
  type QualityMode,
  type RetouchParams,
  type RetouchStrength,
} from "@/lib/retouchPrompt";

type Settings = RetouchParams;
type NumericControlKey = "faceSlimming" | "jawline" | "skin" | "underEye";
type MaskControlKey = keyof MaskSettings;
type TestMode = "masked" | "promptOnly" | "both";

type RetouchResult = {
  id: string;
  name: string;
  finish: string;
  imageUrl: string;
};

type RetouchCandidateImage = {
  id: string;
  b64_json: string;
  label: string;
};

type VersionItem = RetouchResult & {
  kind: "original" | "generated" | "refined";
  parentId: string | null;
  sourceImageUrl: string | null;
  params: Settings | null;
  refinementInstruction?: string;
};

type RetouchApiResponse =
  | {
      success: true;
      prompt: string;
      params: Settings;
      images?: RetouchCandidateImage[];
      image?: RetouchCandidateImage;
      results?: RetouchResult[];
      maskApplied?: boolean;
      refineMode?: "regenerateFromOriginal";
    }
  | {
      success: false;
      error: string;
    };

type RunVariant = {
  key: "masked" | "promptOnly";
  label: string;
  params: Settings;
};

const numericControls: {
  key: NumericControlKey;
  label: string;
  detail: string;
}[] = [
  {
    key: "faceSlimming",
    label: "Lower-face puffiness",
    detail: "Subtle cheek heaviness control",
  },
  {
    key: "jawline",
    label: "Jawline shadow",
    detail: "Existing contour clarity",
  },
  {
    key: "skin",
    label: "Skin cleanup",
    detail: "Tone, blemishes, redness",
  },
  {
    key: "underEye",
    label: "Under-eye freshness",
    detail: "Tiredness without eye changes",
  },
];

const maskControls: {
  key: MaskControlKey;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "centerX", label: "Mask center X", min: 0.2, max: 0.8, step: 0.01 },
  { key: "centerY", label: "Mask center Y", min: 0.35, max: 0.85, step: 0.01 },
  { key: "width", label: "Mask width", min: 0.18, max: 0.7, step: 0.01 },
  { key: "height", label: "Mask height", min: 0.12, max: 0.55, step: 0.01 },
  { key: "feather", label: "Feather", min: 0.02, max: 0.3, step: 0.01 },
];

const editAreaOptions: {
  key: EditArea;
  label: string;
  detail: string;
}[] = [
  {
    key: "jawAndCheeks",
    label: "Jaw & cheeks",
    detail: "Best for reducing lower-face puffiness while preserving identity.",
  },
  {
    key: "skinOnly",
    label: "Skin only",
    detail: "Safest mode. Improves skin while keeping facial structure unchanged.",
  },
  {
    key: "fullFace",
    label: "Full face",
    detail: "Gentle overall retouch. Higher drift risk.",
  },
];

const strengthOptions: {
  key: RetouchStrength;
  label: string;
  detail: string;
}[] = [
  {
    key: "subtle",
    label: "Subtle",
    detail: "3-5% visual change",
  },
  {
    key: "balanced",
    label: "Balanced",
    detail: "6-10% visual change",
  },
  {
    key: "strong",
    label: "Strong",
    detail: "10-15%, still conservative",
  },
];

const qualityModes: {
  key: QualityMode;
  label: string;
  credits: number;
  detail: string;
}[] = [
  {
    key: "fast",
    label: "Fast",
    credits: 1,
    detail: "Draft quality",
  },
  {
    key: "standard",
    label: "Standard",
    credits: 3,
    detail: "Balanced quality",
  },
  {
    key: "best",
    label: "Best",
    credits: 8,
    detail: "Highest quality",
  },
];

const testModes: {
  key: TestMode;
  label: string;
  detail: string;
}[] = [
  {
    key: "masked",
    label: "Masked local edit",
    detail: "Default SameFace flow",
  },
  {
    key: "promptOnly",
    label: "Prompt-only edit",
    detail: "No mask, higher drift risk",
  },
  {
    key: "both",
    label: "Run both",
    detail: "Internal A/B comparison",
  },
];

const candidateCounts = [1, 2, 3] as const;

const refinementControls = [
  {
    label: "More natural",
    instruction:
      "Reduce any AI-generated or over-processed look. Restore natural photo texture, realistic skin, and original lighting. Make the result closer to the original photo.",
  },
  {
    label: "Less puffy",
    instruction:
      "Very slightly reduce the visual impression of lower-face puffiness inside the editable lower-face area only. Do not change facial structure, jaw shape, chin, mouth, nose, or eyes.",
  },
  {
    label: "Clearer jaw shadow",
    instruction:
      "Lightly enhance the existing natural jawline shadow only. Do not redraw or reshape the jaw. Do not create a new jawline.",
  },
  {
    label: "Less polished skin",
    instruction:
      "Restore natural skin texture, pores, small imperfections, and realistic unevenness. Avoid waxy, airbrushed, or plastic skin.",
  },
  {
    label: "Preserve original face more",
    instruction:
      "Prioritize identity preservation over beautification. Make the output closer to the original face. Undo any change that makes the person look like a different person.",
  },
] as const;

function createOriginalVersion(imageUrl: string, name: string): VersionItem {
  return {
    id: "original-upload",
    name: "Original upload",
    finish: name,
    imageUrl,
    kind: "original",
    parentId: null,
    sourceImageUrl: null,
    params: null,
  };
}

function getResultsFromPayload(
  payload: Extract<RetouchApiResponse, { success: true }>,
) {
  if (payload.results?.length) {
    return payload.results;
  }

  if (payload.images?.length) {
    return payload.images.map((image) => ({
      id: image.id,
      name: image.label,
      finish: "OpenAI image edit",
      imageUrl: `data:image/jpeg;base64,${image.b64_json}`,
    }));
  }

  if (payload.image) {
    return [
      {
        id: payload.image.id,
        name: payload.image.label,
        finish: "OpenAI image edit",
        imageUrl: `data:image/jpeg;base64,${payload.image.b64_json}`,
      },
    ];
  }

  return [];
}

function createRunVariants(settings: Settings, testMode: TestMode) {
  const maskedParams = {
    ...settings,
    useMask: settings.useMask,
  };
  const promptOnlyParams = {
    ...settings,
    useMask: false,
  };

  if (testMode === "both") {
    return [
      {
        key: "promptOnly",
        label: "A. Prompt-only edit",
        params: promptOnlyParams,
      },
      {
        key: "masked",
        label: "B. Masked local edit",
        params: maskedParams,
      },
    ] satisfies RunVariant[];
  }

  if (testMode === "promptOnly") {
    return [
      {
        key: "promptOnly",
        label: "A. Prompt-only edit",
        params: promptOnlyParams,
      },
    ] satisfies RunVariant[];
  }

  return [
    {
      key: "masked",
      label: "B. Masked local edit",
      params: maskedParams,
    },
  ] satisfies RunVariant[];
}

async function getImageDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Could not read image size."));
      nextImage.src = objectUrl;
    });

    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function createLowerFaceMaskFile(image: File, mask: MaskSettings) {
  const { width, height } = await getImageDimensions(image);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create mask canvas.");
  }

  canvas.width = width;
  canvas.height = height;

  const centerX = mask.centerX * width;
  const centerY = mask.centerY * height;
  const radiusX = (mask.width * width) / 2;
  const radiusY = (mask.height * height) / 2;
  const feather = Math.max(0.02, Math.min(0.3, mask.feather));

  context.fillStyle = "rgba(255, 255, 255, 1)";
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(centerX, centerY);
  context.scale(radiusX, radiusY);

  const gradient = context.createRadialGradient(
    0,
    0,
    Math.max(0, 1 - feather),
    0,
    0,
    1,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 1)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );

  if (!blob) {
    throw new Error("Could not export mask PNG.");
  }

  return new File([blob], "sameface-lower-face-mask.png", {
    type: "image/png",
  });
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_RETOUCH_PARAMS);
  const [testMode, setTestMode] = useState<TestMode>("masked");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEditArea = editAreaOptions.find(
    (option) => option.key === settings.editArea,
  );
  const selectedQuality = qualityModes.find(
    (mode) => mode.key === settings.qualityMode,
  );
  const runVariantCount = testMode === "both" ? 2 : 1;
  const expectedCandidateSlots = settings.candidateCount * runVariantCount;
  const estimatedCredits =
    (selectedQuality?.credits ?? 3) * expectedCandidateSlots;
  const promptPreview = useMemo(
    () => compileRetouchPrompt(settings),
    [settings],
  );
  const selectedSummary = useMemo(
    () =>
      `${selectedEditArea?.label ?? "Jaw & cheeks"}, ${settings.strength}, ${settings.faceSlimming}/100 puffiness, ${settings.skin}/100 skin, ${settings.candidateCount} candidate${settings.candidateCount === 1 ? "" : "s"}, ${settings.useMask ? "mask on" : "mask off"}`,
    [
      selectedEditArea?.label,
      settings.candidateCount,
      settings.faceSlimming,
      settings.skin,
      settings.strength,
      settings.useMask,
    ],
  );
  const maskOverlayStyle = {
    left: `${(settings.mask.centerX - settings.mask.width / 2) * 100}%`,
    top: `${(settings.mask.centerY - settings.mask.height / 2) * 100}%`,
    width: `${settings.mask.width * 100}%`,
    height: `${settings.mask.height * 100}%`,
    boxShadow: `0 0 ${Math.round(settings.mask.feather * 120)}px ${Math.round(settings.mask.feather * 36)}px rgba(232, 211, 183, 0.35)`,
  };

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);

    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return nextPreviewUrl;
    });
    setImageFile(file);
    setFileName(file.name);
    setVersions([createOriginalVersion(nextPreviewUrl, file.name)]);
    setGeneratedPrompt(null);
    setError(null);
  }

  function updateSetting<Key extends keyof Settings>(
    key: Key,
    value: Settings[Key],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
    setGeneratedPrompt(null);
    setError(null);
  }

  function updateNumericSetting(key: NumericControlKey, value: string) {
    updateSetting(key, Number(value));
  }

  function updateMaskSetting(key: MaskControlKey, value: string) {
    setSettings((current) => ({
      ...current,
      mask: {
        ...current.mask,
        [key]: Number(value),
      },
    }));
    setGeneratedPrompt(null);
    setError(null);
  }

  async function createRetouchForm(
    params: Settings,
    refinementInstruction?: string,
  ) {
    if (!imageFile) {
      throw new Error("Upload an image before generating.");
    }

    const formData = new FormData();
    formData.append("image", imageFile);
    formData.append("params", JSON.stringify(params));
    formData.append("qualityMode", params.qualityMode);
    formData.append("candidateCount", String(params.candidateCount));

    if (params.useMask && params.editArea === "jawAndCheeks") {
      formData.append("mask", await createLowerFaceMaskFile(imageFile, params.mask));
    }

    if (refinementInstruction) {
      formData.append("refineMode", "regenerateFromOriginal");
      formData.append("refinementInstruction", refinementInstruction);
    }

    return formData;
  }

  async function requestRetouch(
    variant: RunVariant,
    refinementInstruction?: string,
  ) {
    const response = await fetch(
      refinementInstruction ? "/api/retouch/refine" : "/api/retouch",
      {
        method: "POST",
        body: await createRetouchForm(variant.params, refinementInstruction),
      },
    );
    const payload = (await response.json()) as RetouchApiResponse;

    if (!response.ok || !payload.success) {
      throw new Error(
        payload.success
          ? "Retouch request failed."
          : payload.error || "Retouch request failed.",
      );
    }

    return payload;
  }

  async function handleGenerate() {
    if (!imageFile) {
      setError("Upload an image before generating.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedPrompt(null);

    try {
      const variants = createRunVariants(settings, testMode);
      const payloads = await Promise.all(
        variants.map(async (variant) => ({
          variant,
          payload: await requestRetouch(variant),
        })),
      );
      const nextVersions: VersionItem[] = [];

      payloads.forEach(({ variant, payload }, variantIndex) => {
        const results = getResultsFromPayload(payload);

        results.forEach((result, resultIndex) => {
          nextVersions.push({
            ...result,
            id: `generated-${variant.key}-${result.id}-${variantIndex}-${resultIndex}`,
            name: `${variant.label} · ${payload.images?.[resultIndex]?.label ?? result.name}`,
            finish: `${payload.maskApplied ? "Masked lower-face edit" : "Prompt-only edit"} · ${result.finish}`,
            kind: "generated",
            parentId: "original-upload",
            sourceImageUrl: previewUrl,
            params: payload.params,
          });
        });
      });

      if (nextVersions.length === 0) {
        setError("Retouch generation did not return any candidates.");
        return;
      }

      setGeneratedPrompt(payloads[0]?.payload.prompt ?? null);
      setVersions([
        previewUrl
          ? createOriginalVersion(previewUrl, fileName ?? imageFile.name)
          : createOriginalVersion("", fileName ?? imageFile.name),
        ...nextVersions,
      ]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not reach the retouch API. Check that the dev server is running.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRefine(
    version: VersionItem,
    refinementLabel: string,
    refinementInstruction: string,
  ) {
    if (!version.params || !imageFile) {
      setError("The original upload is required before refining.");
      return;
    }

    setRefiningId(version.id);
    setError(null);

    try {
      const refineParams = {
        ...version.params,
        candidateCount: 1,
        useMask: version.params.editArea === "jawAndCheeks" && version.params.useMask,
      };
      const variant: RunVariant = {
        key: refineParams.useMask ? "masked" : "promptOnly",
        label: refineParams.useMask ? "B. Masked local edit" : "A. Prompt-only edit",
        params: refineParams,
      };
      const payload = await requestRetouch(variant, refinementInstruction);
      const results = getResultsFromPayload(payload);

      if (results.length === 0) {
        setError("Retouch refinement did not return any candidates.");
        return;
      }

      setGeneratedPrompt(payload.prompt);
      setVersions((current) => [
        ...current,
        ...results.map((result, index) => ({
          ...result,
          id: `refined-${version.id}-${current.length + index}`,
          name: `${version.name} · ${refinementLabel} v2`,
          finish: `${payload.maskApplied ? "Masked regenerate-from-original refine" : "Prompt-only regenerate-from-original refine"} · ${result.finish}`,
          kind: "refined" as const,
          parentId: version.id,
          sourceImageUrl: previewUrl,
          params: payload.params,
          refinementInstruction,
        })),
      ]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Could not reach the refine API. Check that the dev server is running.",
      );
    } finally {
      setRefiningId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f3ee] text-[#211b17]">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#7a6558]">
              SameFace AI
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight text-[#211b17] sm:text-6xl">
              The same person on a better day.
            </h1>
          </div>
          <div className="hidden rounded-full border border-[#d8cbbf] bg-white/70 px-4 py-2 text-sm font-medium text-[#5f5048] shadow-sm sm:block">
            Masked effect tuning
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[8px] border border-[#ddd0c4] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Portrait upload</h2>
                <p className="mt-1 text-sm leading-6 text-[#6e625c]">
                  Upload one face-forward portrait to preview the retouch flow.
                </p>
              </div>
              <span className="rounded-full bg-[#edf1e8] px-3 py-1 text-xs font-semibold text-[#4e6657]">
                JPG PNG WEBP
              </span>
            </div>

            <label className="mt-5 flex aspect-[4/5] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[8px] border border-dashed border-[#bda995] bg-[#fbf8f4] text-center transition hover:border-[#7b5f4c] hover:bg-[#f8f1e9]">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Uploaded portrait preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex max-w-xs flex-col items-center px-6">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#211b17] text-2xl text-white">
                    +
                  </div>
                  <p className="text-base font-semibold">Choose a portrait</p>
                  <p className="mt-2 text-sm leading-6 text-[#756861]">
                    The first version uses a local browser preview only.
                  </p>
                </div>
              )}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUpload}
              />
            </label>

            <div className="mt-4 flex min-h-10 items-center justify-between gap-3 rounded-[8px] bg-[#f5eee7] px-4 py-3 text-sm text-[#675950]">
              <span className="truncate">
                {fileName ?? "No image selected"}
              </span>
              <span className="shrink-0 font-medium">Original source</span>
            </div>

            <section className="mt-5 rounded-[8px] border border-[#e4d8cc] bg-[#fbf8f4] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Edit mask</h2>
                  <p className="mt-1 text-sm leading-6 text-[#6e625c]">
                    Masking is guidance, not pixel-perfect segmentation; keep prompts conservative.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#5f5048]">
                  <input
                    type="checkbox"
                    checked={settings.useMask}
                    onChange={(event) =>
                      updateSetting("useMask", event.target.checked)
                    }
                    className="h-4 w-4 accent-[#7b5f4c]"
                  />
                  Use mask
                </label>
              </div>

              <div className="mt-4 overflow-hidden rounded-[8px] bg-[#eee4da]">
                {previewUrl ? (
                  <div className="relative aspect-[4/5]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt="Mask placement preview"
                      className="h-full w-full object-cover"
                    />
                    {settings.useMask && settings.editArea === "jawAndCheeks" ? (
                      <div
                        className="pointer-events-none absolute rounded-full border-2 border-[#f2e5d4] bg-[#e8d3b7]/35"
                        style={maskOverlayStyle}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-64 items-center justify-center px-6 text-center text-sm leading-6 text-[#7b6b61]">
                    Upload a portrait to preview the lower-face mask.
                  </div>
                )}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {maskControls.map((control) => (
                  <label key={control.key} className="block">
                    <span className="flex items-center justify-between gap-3 text-sm font-medium text-[#5f5048]">
                      {control.label}
                      <span>{settings.mask[control.key].toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={settings.mask[control.key]}
                      onChange={(event) =>
                        updateMaskSetting(control.key, event.target.value)
                      }
                      className="mt-2 h-2 w-full accent-[#7b5f4c]"
                    />
                  </label>
                ))}
              </div>
            </section>
          </section>

          <section className="rounded-[8px] border border-[#ddd0c4] bg-[#211b17] p-4 text-white shadow-sm sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Retouch settings</h2>
                <p className="mt-1 text-sm leading-6 text-[#cfc4bc]">
                  SameFace is currently optimized for subtle realism, not dramatic beautification.
                </p>
              </div>
            </div>

            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium text-[#e7ddd4]">
                Internal test mode
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {testModes.map((mode) => {
                  const selected = testMode === mode.key;

                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => setTestMode(mode.key)}
                      className={`min-h-20 rounded-[8px] border px-3 py-2 text-left transition ${
                        selected
                          ? "border-[#e8d3b7] bg-[#e8d3b7] text-[#211b17]"
                          : "border-white/15 bg-white/5 text-[#d8cec6] hover:border-white/35 hover:bg-white/10"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {mode.label}
                      </span>
                      <span className="mt-1 block text-xs font-medium opacity-80">
                        {mode.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium text-[#e7ddd4]">
                Edit area
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {editAreaOptions.map((option) => {
                  const selected = settings.editArea === option.key;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => updateSetting("editArea", option.key)}
                      className={`min-h-28 rounded-[8px] border px-3 py-3 text-left transition ${
                        selected
                          ? "border-[#e8d3b7] bg-[#e8d3b7] text-[#211b17]"
                          : "border-white/15 bg-white/5 text-[#d8cec6] hover:border-white/35 hover:bg-white/10"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {option.label}
                      </span>
                      <span className="mt-2 block text-xs leading-5 opacity-80">
                        {option.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
              {settings.editArea === "fullFace" ? (
                <p className="mt-2 text-xs leading-5 text-[#f2c6bc]">
                  Full face currently runs without a mask and has higher drift risk.
                </p>
              ) : null}
              {settings.editArea === "skinOnly" ? (
                <p className="mt-2 text-xs leading-5 text-[#d8cec6]">
                  Skin only uses extra-conservative prompt guidance; no face mask is sent yet.
                </p>
              ) : null}
            </fieldset>

            <div className="mt-6 space-y-5">
              {numericControls.map((control) => (
                <label key={control.key} className="block">
                  <span className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium text-[#e7ddd4]">
                        {control.label}
                      </span>
                      <span className="mt-1 block text-xs text-[#b6aaa1]">
                        {control.detail}
                      </span>
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-[#f2e5d4]">
                      {settings[control.key]}/100
                    </span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    step="1"
                    value={settings[control.key]}
                    onChange={(event) =>
                      updateNumericSetting(control.key, event.target.value)
                    }
                    className="mt-3 h-2 w-full accent-[#e8d3b7]"
                  />
                </label>
              ))}
            </div>

            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium text-[#e7ddd4]">
                Strength
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {strengthOptions.map((option) => {
                  const selected = settings.strength === option.key;

                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => updateSetting("strength", option.key)}
                      className={`min-h-20 rounded-[8px] border px-3 py-2 text-left transition ${
                        selected
                          ? "border-[#e8d3b7] bg-[#e8d3b7] text-[#211b17]"
                          : "border-white/15 bg-white/5 text-[#d8cec6] hover:border-white/35 hover:bg-white/10"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {option.label}
                      </span>
                      <span className="mt-1 block text-xs font-medium opacity-80">
                        {option.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="mt-6 flex items-center justify-between gap-4 rounded-[8px] border border-white/10 bg-white/5 p-4">
              <span>
                <span className="block text-sm font-medium text-[#e7ddd4]">
                  Identity lock
                </span>
                <span className="mt-1 block text-xs leading-5 text-[#b6aaa1]">
                  Maximum facial feature preservation
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.identityLock}
                onChange={(event) =>
                  updateSetting("identityLock", event.target.checked)
                }
                className="h-5 w-5 accent-[#e8d3b7]"
              />
            </label>

            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium text-[#e7ddd4]">
                Quality mode
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {qualityModes.map((mode) => {
                  const selected = settings.qualityMode === mode.key;

                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => updateSetting("qualityMode", mode.key)}
                      className={`min-h-20 rounded-[8px] border px-3 py-2 text-left transition ${
                        selected
                          ? "border-[#e8d3b7] bg-[#e8d3b7] text-[#211b17]"
                          : "border-white/15 bg-white/5 text-[#d8cec6] hover:border-white/35 hover:bg-white/10"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {mode.label}
                      </span>
                      <span className="mt-1 block text-xs font-medium opacity-80">
                        {mode.detail}
                      </span>
                      <span className="mt-2 block text-xs font-semibold">
                        {mode.credits} credit{mode.credits === 1 ? "" : "s"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="mb-2 text-sm font-medium text-[#e7ddd4]">
                Candidates
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {candidateCounts.map((count) => {
                  const selected = settings.candidateCount === count;

                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => updateSetting("candidateCount", count)}
                      className={`min-h-11 rounded-[8px] border px-3 text-sm font-semibold transition ${
                        selected
                          ? "border-[#e8d3b7] bg-[#e8d3b7] text-[#211b17]"
                          : "border-white/15 bg-white/5 text-[#d8cec6] hover:border-white/35 hover:bg-white/10"
                      }`}
                    >
                      {count}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-6 rounded-[8px] border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b6aaa1]">
                Current recipe
              </p>
              <p className="mt-2 text-sm leading-6 text-[#f4ece5]">
                {selectedSummary}
              </p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#f2e5d4]">
                Estimated usage: {estimatedCredits} credit
                {estimatedCredits === 1 ? "" : "s"}
              </p>
            </div>

            <div className="mt-3 rounded-[8px] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-[#d8cec6]">
              <p className="font-semibold text-[#f4ece5]">
                For best identity preservation tests:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Use a clear portrait</li>
                <li>Avoid extreme angles</li>
                <li>Start with Skin only or Jaw & cheeks</li>
                <li>Use Subtle strength</li>
                <li>Avoid repeated refine passes</li>
                <li>Compare against the original at 100% zoom</li>
              </ul>
            </div>

            <details className="mt-3 rounded-[8px] border border-white/10 bg-white/5 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-[#f4ece5] marker:text-[#b6aaa1]">
                Prompt preview
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#d8cec6]">
                {generatedPrompt ?? promptPreview}
              </p>
            </details>

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-[8px] border border-[#ffb4a8] bg-[#3b1512] px-4 py-3 text-sm leading-6 text-[#ffd7d1]"
              >
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!imageFile || isGenerating}
              className="mt-5 flex h-13 w-full items-center justify-center rounded-[8px] bg-[#f2e5d4] px-5 text-base font-semibold text-[#211b17] transition hover:bg-[#ead7bf] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/35"
            >
              {isGenerating
                ? "Generating..."
                : `Generate ${expectedCandidateSlots} test image${expectedCandidateSlots === 1 ? "" : "s"}`}
            </button>
          </section>
        </div>

        <section className="rounded-[8px] border border-[#ddd0c4] bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-lg font-semibold">Before / after results</h2>
              <p className="mt-1 text-sm leading-6 text-[#6e625c]">
                The edited portraits appear here after generation.
              </p>
            </div>
            <p className="text-sm font-medium text-[#806b5e]">
              {isGenerating
                ? "Generating candidates"
                : versions.length > 0
                  ? `${versions.length} version${versions.length === 1 ? "" : "s"} in history`
                  : "Waiting for generation"}
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {isGenerating
              ? Array.from({ length: expectedCandidateSlots }).map((_, index) => (
                  <div
                    key={index}
                    className="flex min-h-64 items-center justify-center rounded-[8px] border border-dashed border-[#d8c9bb] bg-[#fbf8f4] px-6 text-center text-sm font-semibold leading-6 text-[#7b6b61]"
                  >
                    Generating test image {index + 1}...
                  </div>
                ))
              : versions.length > 0
                ? versions.map((version) => (
                    <article
                      key={version.id}
                      className="overflow-hidden rounded-[8px] border border-[#e4d8cc] bg-[#fbf8f4]"
                    >
                      {version.kind === "original" ? (
                        <div className="relative aspect-[4/5] bg-[#eee4da]">
                          {version.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={version.imageUrl}
                              alt="Original uploaded portrait"
                              className="h-full w-full object-cover"
                            />
                          ) : null}
                          <span className="absolute left-3 top-3 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold text-white">
                            Original
                          </span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2">
                          <div className="relative aspect-[4/5] bg-[#eee4da]">
                            {version.sourceImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={version.sourceImageUrl}
                                alt={`${version.name} source preview`}
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                            <span className="absolute left-3 top-3 rounded-full bg-black/65 px-3 py-1 text-xs font-semibold text-white">
                              Original
                            </span>
                          </div>
                          <div className="relative aspect-[4/5] bg-[#eee4da]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={version.imageUrl}
                              alt={`${version.name} edited portrait`}
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute left-3 top-3 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-[#211b17]">
                              Result
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold">{version.name}</h3>
                          <span className="rounded-full bg-[#edf1e8] px-3 py-1 text-xs font-semibold text-[#4e6657]">
                            {version.kind === "original"
                              ? "Original"
                              : "Edited"}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[#6b5d55]">
                          {version.finish}
                        </p>
                        {version.parentId ? (
                          <p className="mt-1 text-xs font-medium text-[#8a786b]">
                            Child of {version.parentId}
                          </p>
                        ) : null}
                        {version.refinementInstruction ? (
                          <p className="mt-2 text-sm leading-6 text-[#6b5d55]">
                            {version.refinementInstruction}
                          </p>
                        ) : null}
                        {version.kind !== "original" ? (
                          <div className="mt-4 border-t border-[#e4d8cc] pt-4">
                            <p className="text-sm font-semibold text-[#3a302a]">
                              Micro-adjust from original
                            </p>
                            <p className="mt-1 text-sm leading-6 text-[#6b5d55]">
                              To preserve identity, SameFace regenerates from the original photo instead of repeatedly editing an AI result.
                            </p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {refinementControls.map((control) => (
                                <button
                                  key={control.label}
                                  type="button"
                                  onClick={() =>
                                    handleRefine(
                                      version,
                                      control.label,
                                      control.instruction,
                                    )
                                  }
                                  disabled={refiningId !== null}
                                  className="min-h-10 rounded-[8px] border border-[#d8c9bb] bg-white px-3 text-sm font-semibold text-[#3a302a] transition hover:border-[#9d826d] hover:bg-[#f4ece5] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {refiningId === version.id
                                    ? "Regenerating..."
                                    : control.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))
                : Array.from({ length: expectedCandidateSlots }).map(
                    (_, index) => (
                      <div
                        key={index}
                        className="flex min-h-64 items-center justify-center rounded-[8px] border border-dashed border-[#d8c9bb] bg-[#fbf8f4] px-6 text-center text-sm leading-6 text-[#7b6b61]"
                      >
                        Upload a portrait and generate to preview test image{" "}
                        {index + 1}.
                      </div>
                    ),
                  )}
          </div>
        </section>
      </section>
    </main>
  );
}
