const questionText = document.getElementById("question-text");
const voiceBtn = document.getElementById("voice-btn");
const voiceStatus = document.getElementById("voice-status");
const answerText = document.getElementById("answer-text");
const scoreLoading = document.getElementById("score-loading");
const scoreGrammar = document.getElementById("score-grammar");
const scorePronunciation = document.getElementById("score-pronunciation");
const scoreExpression = document.getElementById("score-expression");
const scoreOverall = document.getElementById("score-overall");
const scoreSourceLabel = document.getElementById("score-source");
const feedbackList = document.getElementById("feedback-list");
const settingsBtn = document.getElementById("settings-btn");
const settingsPage = document.getElementById("settings-page");
const settingsMoreBtn = document.getElementById("settings-more-btn");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const navPage = document.getElementById("nav-page");
const navMinimathsBtn = document.getElementById("nav-minimaths-btn");
const navMiniEngBtn = document.getElementById("nav-mini-eng-btn");
const navXiaoguwenBtn = document.getElementById("nav-xiaoguwen-btn");
const navNovelBtn = document.getElementById("nav-novel-btn");
const navSpeedBtn = document.getElementById("nav-speed-btn");
const navRechargeBtn = document.getElementById("nav-recharge-btn");
const navCloseBtn = document.getElementById("nav-close-btn");
const navUserBtn = document.getElementById("nav-user-btn");
const aiProviderSelect = document.getElementById("ai-provider");
const aiKeyInput = document.getElementById("ai-key");
const settingsSaveBtn = document.getElementById("settings-save-btn");
const questionModeSelect = document.getElementById("question-mode");
const textAnswerInput = document.getElementById("text-answer-input");
const textSubmitBtn = document.getElementById("text-submit-btn");

const MINI_ENG_AI_COOKIE = "mini_eng_ai_config";
const MINI_ENG_MODE_COOKIE = "mini_eng_mode";
const AVAILABLE_MODES = ["qa", "spoken_expression"];

const TOPICS = [
  "What is your favorite food and why?",
  "Where did you go yesterday?",
  "How do you usually spend your weekends?",
  "Describe your best friend.",
  "What do you want to do this summer?",
  "What is your favorite movie?",
  "How do you learn English every day?",
  "Tell me about your hometown.",
  "What did you do last weekend?",
  "If you could travel anywhere, where would you go?",
];

const SPOKEN_EXPRESSIONS = [
  {
    prompt: "下班了，你会对身边的同事说什么？",
    expected: "calling it a night",
  },
];

let currentQuestion = "";
// 当前这一题实际使用的模式（会传给后端）
let currentMode = "qa"; // qa | spoken_expression | 未来更多
// 用户设置的题型选项：qa | spoken_expression | default
let currentModeSetting = "default";
let currentExpected = "";
let recognition = null;
let transcriptFinal = "";
let transcriptInterim = "";
let latestConfidence = 0;
let isRecording = false;
let stopTimer = null;
let aiConfig = {
  provider: "openai",
  key: "",
};

function getCookieValue(key) {
  const cookieText = document.cookie || "";
  const parts = cookieText.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(key + "=")) return decodeURIComponent(trimmed.slice(key.length + 1));
  }
  return "";
}

function setCookieValue(key, value, days) {
  const maxAge = Math.max(0, Math.floor(days * 24 * 60 * 60));
  document.cookie =
    key + "=" + encodeURIComponent(value) + "; Max-Age=" + maxAge + "; Path=/; SameSite=Lax";
}

function loadAiConfigFromCookie() {
  const raw = getCookieValue(MINI_ENG_AI_COOKIE);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.provider === "string") aiConfig.provider = parsed.provider;
    if (typeof parsed?.key === "string") aiConfig.key = parsed.key;
  } catch {
    // ignore parse errors
  }
}

function saveAiConfigToCookie() {
  setCookieValue(MINI_ENG_AI_COOKIE, JSON.stringify(aiConfig), 365);
}

function loadModeFromCookie() {
  const raw = getCookieValue(MINI_ENG_MODE_COOKIE);
  if (raw === "qa" || raw === "spoken_expression" || raw === "default") {
    currentModeSetting = raw;
  } else {
    currentModeSetting = "default";
  }
}

function saveModeToCookie() {
  setCookieValue(MINI_ENG_MODE_COOKIE, currentModeSetting, 365);
}

function randomTopic() {
  const idx = Math.floor(Math.random() * TOPICS.length);
  return TOPICS[idx];
}

function randomSpokenExpression() {
  const idx = Math.floor(Math.random() * SPOKEN_EXPRESSIONS.length);
  return SPOKEN_EXPRESSIONS[idx];
}

function setQuestion(topic) {
  currentExpected = "";
  currentQuestion = topic;
  questionText.textContent = topic;
}

function setSpokenExpressionQuestion(item) {
  currentExpected = item.expected;
  currentQuestion = item.prompt;
  questionText.textContent = item.prompt;
}

function applyModeAndQuestionForCurrentSetting() {
  if (currentModeSetting === "qa") {
    currentMode = "qa";
    setQuestion(randomTopic());
    answerText.textContent = "请点击“回答”并用英文作答";
    return;
  }
  if (currentModeSetting === "spoken_expression") {
    currentMode = "spoken_expression";
    setSpokenExpressionQuestion(randomSpokenExpression());
    answerText.textContent = "请用英文短语作答（可语音或输入）";
    return;
  }

  // 默认：从已注册题型里随机挑一个
  const pool = AVAILABLE_MODES.length ? AVAILABLE_MODES : ["qa"];
  const idx = Math.floor(Math.random() * pool.length);
  const picked = pool[idx];
  currentMode = picked;
  if (picked === "spoken_expression") {
    setSpokenExpressionQuestion(randomSpokenExpression());
    answerText.textContent = "请用英文短语作答（可语音或输入）";
  } else {
    setQuestion(randomTopic());
    answerText.textContent = "请点击“回答”并用英文作答";
  }
}

function openSettings() {
  aiProviderSelect.value = aiConfig.provider || "openai";
  aiKeyInput.value = aiConfig.key || "";
  questionModeSelect.value = currentModeSetting || "default";
  settingsPage.classList.add("is-open");
}

function closeSettings() {
  settingsPage.classList.remove("is-open");
}

function openNav() {
  navPage.classList.add("is-open");
}

function closeNav() {
  navPage.classList.remove("is-open");
}

function setScoreView(result) {
  scoreGrammar.textContent = String(result.scores.grammar);
  scorePronunciation.textContent = String(result.scores.pronunciation);
  scoreExpression.textContent = String(result.scores.expression);
  scoreOverall.textContent = String(result.scores.overall);

  if (scoreSourceLabel) {
    const src = String(result.source || "").toLowerCase();
    const model = String(result.model || "").trim();
    let text = "（该评分来自于本地模型）";
    if (src && src !== "heuristic") {
      if (src.includes("qwen")) {
        text = model ? `（该评分来自于 Qwen：${model}）` : "（该评分来自于 Qwen）";
      } else if (src.includes("deepseek")) {
        text = model ? `（该评分来自于 DeepSeek：${model}）` : "（该评分来自于 DeepSeek）";
      } else if (src.includes("openai")) {
        text = model ? `（该评分来自于 OpenAI：${model}）` : "（该评分来自于 OpenAI）";
      } else {
        text = model ? `（该评分来自于远程模型：${model}）` : "（该评分来自于远程模型）";
      }
    }
    scoreSourceLabel.textContent = text;
  }

  feedbackList.innerHTML = "";
  const lines = [
    "语法: " + result.feedback.grammar,
    "发音: " + result.feedback.pronunciation,
    "表达: " + result.feedback.expression,
    "综合建议: " + result.feedback.overall,
  ];
  if (result.improvedAnswer) {
    lines.push("参考表达: " + result.improvedAnswer);
  }
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    feedbackList.appendChild(li);
  }
}

function setRecordingUI(recording) {
  isRecording = recording;
  if (recording) {
    voiceBtn.textContent = "停止语音";
    voiceBtn.classList.add("recording");
  } else {
    voiceBtn.textContent = "回答";
    voiceBtn.classList.remove("recording");
  }
}

function stopRecording() {
  if (!recognition || !isRecording) return;
  recognition.stop();
}

async function evaluateAnswer(answerOverride) {
  const finalAnswer = String(answerOverride ?? (transcriptFinal || transcriptInterim)).trim();
  if (!finalAnswer) {
    voiceStatus.textContent = "没有识别到有效语音，请再试一次";
    return;
  }

  scoreLoading.style.display = "block";
  voiceStatus.textContent = "正在请求 AI 评分...";
  try {
    const resp = await fetch("/api/mini-eng/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: currentMode,
        question: currentQuestion,
        expectedAnswer: currentExpected,
        answer: finalAnswer,
        recognitionConfidence: answerOverride ? 0 : latestConfidence,
        aiConfig: {
          provider: aiConfig.provider,
          key: aiConfig.key,
        },
      }),
    });
    if (!resp.ok) throw new Error("evaluate failed");
    const data = await resp.json();
    setScoreView(data);
    voiceStatus.textContent = "评分完成";
    if (!aiConfig.key.trim()) {
      voiceStatus.textContent = "评分完成（当前未配置 Key，使用本地兜底评分）";
    }
  } catch (error) {
    voiceStatus.textContent = "评分失败，请稍后再试";
  } finally {
    scoreLoading.style.display = "none";
  }
}

function resetTranscript() {
  transcriptFinal = "";
  transcriptInterim = "";
  latestConfidence = 0;
  answerText.textContent = "请开始作答...";
  if (textAnswerInput) textAnswerInput.value = "";
}

function ensureRecognition() {
  if (recognition) return recognition;
  const API = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!API) return null;

  recognition = new API();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    setRecordingUI(true);
    voiceStatus.textContent = "录音中... 请在10秒内完成回答";
    stopTimer = setTimeout(() => {
      voiceStatus.textContent = "10秒到，自动停止";
      stopRecording();
    }, 10000);
  };

  recognition.onresult = (event) => {
    let nextFinal = transcriptFinal;
    let nextInterim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const alt = result[0];
      if (!alt) continue;
      latestConfidence = Math.max(latestConfidence, Number(alt.confidence) || 0);
      if (result.isFinal) nextFinal += (nextFinal ? " " : "") + alt.transcript;
      else nextInterim += (nextInterim ? " " : "") + alt.transcript;
    }
    transcriptFinal = nextFinal.trim();
    transcriptInterim = nextInterim.trim();
    answerText.textContent = [transcriptFinal, transcriptInterim].filter(Boolean).join(" ");
  };

  recognition.onerror = (event) => {
    voiceStatus.textContent = "语音识别失败: " + (event.error || "unknown");
  };

  recognition.onend = async () => {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    setRecordingUI(false);
    await evaluateAnswer();
  };

  return recognition;
}

function startRecording() {
  const engine = ensureRecognition();
  if (!engine) {
    voiceStatus.textContent = "当前浏览器不支持语音识别，请使用新版 Chrome";
    return;
  }
  resetTranscript();
  try {
    engine.start();
  } catch {
    voiceStatus.textContent = "语音识别启动失败，请稍后再试";
  }
}

voiceBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  else startRecording();
});

textSubmitBtn.addEventListener("click", async () => {
  const typed = (textAnswerInput.value || "").trim();
  if (!typed) {
    voiceStatus.textContent = "请输入英文答案后再提交";
    return;
  }
  transcriptFinal = typed;
  transcriptInterim = "";
  answerText.textContent = typed;
  await evaluateAnswer(typed);
});

textAnswerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    textSubmitBtn.click();
  }
});

settingsBtn.addEventListener("click", () => {
  openSettings();
});

settingsCloseBtn.addEventListener("click", () => {
  closeSettings();
});

settingsSaveBtn.addEventListener("click", () => {
  aiConfig = {
    provider: aiProviderSelect.value || "openai",
    key: aiKeyInput.value.trim(),
  };
  currentModeSetting =
    questionModeSelect.value === "qa" ||
    questionModeSelect.value === "spoken_expression" ||
    questionModeSelect.value === "default"
      ? questionModeSelect.value
      : "default";
  saveAiConfigToCookie();
  saveModeToCookie();
  closeSettings();
  voiceStatus.textContent = aiConfig.key ? "AI 配置已保存" : "已保存（未填写 Key 时将使用兜底评分）";
  resetTranscript();
  applyModeAndQuestionForCurrentSetting();
});

settingsMoreBtn.addEventListener("click", () => {
  window.location.href = "/";
});

navCloseBtn.addEventListener("click", () => {
  closeNav();
});

navMinimathsBtn.addEventListener("click", () => {
  window.location.href = "/minimaths.html";
});

navMiniEngBtn.addEventListener("click", () => {
  closeNav();
  closeSettings();
});

navXiaoguwenBtn.addEventListener("click", () => {
  window.location.href = "/xiaoguwen.html";
});

navNovelBtn.addEventListener("click", () => {
  window.location.href = "/novel.html";
});

navSpeedBtn.addEventListener("click", () => {
  window.location.href = "/processing-speed.html";
});

navRechargeBtn.addEventListener("click", () => {
  window.location.href = "/recharge.html";
});

if (navUserBtn) {
  navUserBtn.addEventListener("click", () => {
    window.location.href = "/user.html";
  });
}

loadAiConfigFromCookie();
loadModeFromCookie();
applyModeAndQuestionForCurrentSetting();
