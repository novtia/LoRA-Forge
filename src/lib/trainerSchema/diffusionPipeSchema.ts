import type { DiffusionPipeConfig } from "../types";
import type { TrainerField, TrainerSection } from "./types";

type F = TrainerField<DiffusionPipeConfig>;
const text = (key: F["key"], label: string, hint?: string): F => ({ key, label, kind: "text", hint });
const num = (key: F["key"], label: string, min = 0, hint?: string): F => ({ key, label, kind: "number", min, hint });
const toggle = (key: F["key"], label: string, hint?: string): F => ({ key, label, kind: "toggle", hint });
const select = (key: F["key"], label: string, options: F["options"], hint?: string): F => ({
  key, label, kind: "select", options, hint,
});
const file = (key: F["key"], label: string, extensions?: string[]): F => ({ key, label, kind: "file", extensions });
const dir = (key: F["key"], label: string): F => ({ key, label, kind: "directory" });

export const diffusionPipeModelOptions = [
  "hunyuan-video", "hunyuan_video_15", "hunyuan_image", "wan", "flux", "flux2",
  "ltx-video", "ltx2", "sdxl", "sd3", "cosmos", "cosmos_predict2", "anima",
  "lumina_2", "chroma", "hidream", "omnigen2", "qwen_image", "auraflow",
  "z_image", "ernie_image", "ideogram4", "krea2",
];

export const diffusionPipeSections: TrainerSection<DiffusionPipeConfig>[] = [
  {
    id: "model",
    title: "模型",
    description: "diffusion-pipe 模型实现及各组件权重。",
    fields: [
      select("modelType", "模型类型", diffusionPipeModelOptions),
      file("modelPath", "模型主路径", ["safetensors", "ckpt", "pt", "bin"]),
      file("transformerPath", "Transformer 路径", ["safetensors", "ckpt", "pt"]),
      file("vaePath", "VAE 路径", ["safetensors", "pt", "bin"]),
      file("llmPath", "LLM / 文本编码器路径"),
      file("clipPath", "CLIP 路径"),
      select("modelDtype", "模型 dtype", ["float32", "float16", "bfloat16", "float8"]),
      select("transformerDtype", "Transformer dtype", ["", "float32", "float16", "bfloat16", "float8", "float8_e4m3fn", "float8_e5m2"]),
      select("diffusionModelDtype", "Diffusion Model dtype", ["", "float32", "float16", "bfloat16", "float8"]),
      select("timestepSampleMethod", "时间步采样方法", ["logit_normal", "uniform"]),
      text("sigmoidScale", "Logit-normal Sigmoid Scale"),
      text("modelGuidance", "模型 Guidance"),
    ],
  },
  {
    id: "training",
    title: "训练循环",
    fields: [
      num("epochs", "Epochs", 1),
      num("maxSteps", "最大 Steps（0=不限）"),
      num("microBatchSizePerGpu", "每 GPU Micro Batch", 1),
      num("imageMicroBatchSizePerGpu", "图片专用 Micro Batch（0=继承）"),
      num("gradientAccumulationSteps", "梯度累积步数", 1),
      text("gradientClipping", "梯度裁剪"),
      num("warmupSteps", "Warmup Steps"),
      text("forceConstantLr", "强制恒定学习率"),
      select("lrScheduler", "LR Scheduler", ["constant", "linear", "cosine"]),
      text("pseudoHuberC", "Pseudo Huber C"),
      text("uncondFraction", "Unconditional Fraction"),
      select("videoClipMode", "视频切片模式", ["single_beginning", "single_middle"]),
      toggle("xAxisExamples", "监控横轴使用样本数"),
      num("loggingSteps", "Metrics 记录间隔", 1),
      num("stepsPerPrint", "DeepSpeed 日志间隔", 1),
    ],
  },
  {
    id: "adapter",
    title: "Adapter / 全量微调",
    fields: [
      select("adapterType", "Adapter 类型", [
        { value: "lora", label: "LoRA" },
        { value: "lokr", label: "LoKr" },
        { value: "", label: "无 Adapter（全量微调）" },
      ]),
      num("loraRank", "Rank", 1),
      select("loraDtype", "Adapter dtype", ["float32", "float16", "bfloat16"]),
      text("adapterDropout", "LoRA Dropout"),
      file("adapterInitFromExisting", "从现有 Adapter 初始化", ["safetensors"]),
      num("lokrDecomposeFactor", "LoKr Decompose Factor", 1),
      text("lokrRankDropout", "LoKr Rank Dropout"),
    ],
  },
  {
    id: "optimizer",
    title: "优化器",
    fields: [
      text("optimizerType", "优化器类型", "adamw_optimi、AdamW8bitKahan、automagic、Prodigy 或 pytorch-optimizer 类名"),
      text("lr", "学习率"),
      text("weightDecay", "Weight Decay"),
      text("optimizerBetas", "Betas", "逗号分隔，如 0.9,0.99"),
      text("optimizerEps", "Epsilon"),
      toggle("optimizerStabilize", "Stabilize"),
      toggle("optimizerGradientRelease", "Gradient Release"),
      text("optimizerArgs", "额外优化器参数", "逗号分隔 key=value"),
    ],
  },
  {
    id: "memory",
    title: "显存与执行",
    fields: [
      select("activationCheckpointing", "激活检查点", [
        { value: "false", label: "关闭" },
        { value: "true", label: "开启" },
        { value: "unsloth", label: "Unsloth" },
      ]),
      toggle("reentrantActivationCheckpointing", "Reentrant Activation Checkpointing"),
      num("blocksToSwap", "Blocks To Swap"),
      toggle("disableBlockSwapForEval", "Eval 时关闭 Block Swap"),
      toggle("compile", "torch.compile"),
      toggle("ncclDisable", "禁用 NCCL P2P / IB"),
    ],
  },
  {
    id: "dataset",
    title: "数据集",
    fields: [
      text("datasetResolutions", "训练分辨率", "逗号分隔；宽高对可写成 [1280,720]"),
      text("frameBuckets", "Frame Buckets", "如 1,33,65"),
      num("numRepeats", "目录重复次数", 1),
      toggle("enableArBucket", "启用宽高比分桶"),
      text("minAr", "最小宽高比"),
      text("maxAr", "最大宽高比"),
      num("numArBuckets", "AR Bucket 数量", 1),
      text("arBuckets", "手动 AR Buckets", "留空使用 Min/Max；如 [512,512], [448,576]"),
      num("cacheShuffleNum", "缓存 Caption Shuffle 次数"),
      text("cacheShuffleDelimiter", "缓存 Caption 分隔符"),
      toggle("skipEmptyCaption", "跳过缺少 Caption 的样本"),
      dir("maskPath", "Mask 目录（应用到所有训练目录）"),
    ],
  },
  {
    id: "evaluation",
    title: "评估",
    fields: [
      num("evalEveryNEpochs", "每 N Epoch Eval"),
      num("evalEveryNSteps", "每 N Step Eval"),
      num("evalEveryNExamples", "每 N 样本 Eval"),
      toggle("evalBeforeFirstStep", "训练前 Eval"),
      num("evalMicroBatchSizePerGpu", "Eval Micro Batch", 1),
      num("imageEvalMicroBatchSizePerGpu", "图片 Eval Micro Batch（0=继承）"),
      num("evalGradientAccumulationSteps", "Eval 梯度累积", 1),
    ],
  },
  {
    id: "saving",
    title: "保存与恢复",
    fields: [
      select("saveDtype", "保存 dtype", ["float32", "float16", "bfloat16"]),
      num("saveEveryNEpochs", "每 N Epoch 保存"),
      num("saveEveryNSteps", "每 N Step 保存"),
      num("saveEveryNExamples", "每 N 样本保存"),
      num("checkpointEveryNEpochs", "每 N Epoch 保存训练 State"),
      num("checkpointEveryNMinutes", "每 N 分钟保存训练 State"),
      text("resumeFromCheckpoint", "恢复 Checkpoint", "latest 或 checkpoint 目录名/路径"),
      toggle("resetDataloader", "恢复时重置 DataLoader"),
      toggle("resetOptimizer", "恢复时重置 Optimizer"),
      toggle("resetOptimizerParams", "恢复时重置 Optimizer 参数"),
    ],
  },
  {
    id: "cache",
    title: "缓存控制",
    fields: [
      toggle("regenerateCache", "强制重新生成缓存"),
      toggle("trustCache", "信任现有缓存元数据"),
    ],
  },
  {
    id: "monitoring",
    title: "WandB 监控",
    fields: [
      toggle("enableWandb", "启用 WandB"),
      text("wandbApiKey", "WandB API Key"),
      text("wandbTrackerName", "WandB Tracker 名称"),
      text("wandbRunName", "WandB Run 名称"),
    ],
  },
];
