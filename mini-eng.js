const questionText = document.getElementById("question-text");
const voiceBtn = document.getElementById("voice-btn");
const voiceStatus = document.getElementById("voice-status");
const answerText = document.getElementById("answer-text");
const scoreLoading = document.getElementById("score-loading");
const scoreGrammar = document.getElementById("score-grammar");
const scorePronunciation = document.getElementById("score-pronunciation");
const scoreExpression = document.getElementById("score-expression");
const scoreOverall = document.getElementById("score-overall");
const feedbackList = document.getElementById("feedback-list");
const settingsBtn = document.getElementById("settings-btn");
const settingsPage = document.getElementById("settings-page");
const settingsMoreBtn = document.getElementById("settings-more-btn");
const settingsCloseBtn = document.getElementById("settings-close-btn");
const navPage = document.getElementById("nav-page");
const navMinimathsBtn = document.getElementById("nav-minimaths-btn");
const navMiniEngBtn = document.getElementById("nav-mini-eng-btn");
const navXiaoguwenBtn = document.getElementById("nav-xiaoguwen-btn");
const navCloseBtn = document.getElementById("nav-close-btn");

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

let currentQuestion = "";
let recognition = null;
let transcriptFinal = "";
let transcriptInterim = "";
let latestConfidence = 0;
let isRecording = false;
let stopTimer = null;

function randomTopic() {
  const idx = Math.floor(Math.random() * TOPICS.length);
  return TOPICS[idx];
}

function setQuestion(topic) {
  currentQuestion = topic;
  questionText.textContent = topic;
}

function openSettings() {
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

async function evaluateAnswer() {
  const finalAnswer = (transcriptFinal || transcriptInterim).trim();
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
        question: currentQuestion,
        answer: finalAnswer,
        recognitionConfidence: latestConfidence,
      }),
    });
    if (!resp.ok) throw new Error("evaluate failed");
    const data = await resp.json();
    setScoreView(data);
    voiceStatus.textContent = "评分完成";
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

settingsBtn.addEventListener("click", () => {
  openSettings();
});

settingsCloseBtn.addEventListener("click", () => {
  closeSettings();
});

settingsMoreBtn.addEventListener("click", () => {
  openNav();
});

navCloseBtn.addEventListener("click", () => {
  closeNav();
});

navMinimathsBtn.addEventListener("click", () => {
  window.location.href = "/";
});

navMiniEngBtn.addEventListener("click", () => {
  closeNav();
  closeSettings();
});

navXiaoguwenBtn.addEventListener("click", () => {
  window.location.href = "/xiaoguwen.html";
});

setQuestion(randomTopic());
