const { tools, handlers } = require("./tools");

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MAX_STEPS = 6;

const SYSTEM =
  "너는 제주도 여행 추천 도우미다. 사용자의 요청에 맞게 find_spots 와 get_weather 도구를 스스로 골라 부르고, 그 결과만 근거로 추천한다.\n" +
  "- 날씨, 날짜, 비·더위·바람 같은 말이 나오거나 실내/야외 선택이 날씨에 달려 있으면 먼저 get_weather 로 확인한다.\n" +
  "- 비가 오거나 강수확률이 높으면 실내(indoor: true), 맑으면 야외를 우선 고려한다. 사용자가 실내/야외를 정했으면 그대로 따른다.\n" +
  "- 지역을 말하지 않았으면 동쪽 · 서쪽 · 서귀포 · 제주시 중 가장 어울리는 곳을 골라 그 이유를 말한다.\n" +
  "- find_spots 가 돌려준 장소만 추천한다. 목록 밖 장소는 없으니 지어내지 말고, 제주도 밖 장소는 지원하지 않는다고 답한다.\n" +
  "- 장소 이름은 도구 결과에 나온 그대로 쓴다. 추천은 3~5곳, 왜 이 날씨에 어울리는지 한두 문장씩 쉽게 설명한다.";

// tools.js 의 도구 설명(name · description · input_schema)을 Gemini 형식으로 옮긴다.
const functionDeclarations = tools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.input_schema,
}));

async function callGemini(contents) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents,
        tools: [{ functionDeclarations }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    }
  );
  if (res.status === 429) throw new Error("Gemini 무료 사용량을 넘었습니다. 잠시 뒤에 다시 시도해 주세요.");
  if (!res.ok) throw new Error(`Gemini API 오류(${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// POST /api/chat  { message, history: [{role, content}] }
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 만 지원합니다." });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "서버에 GEMINI_API_KEY 환경 변수가 없습니다." });
  }

  const { message, history = [] } = req.body || {};
  if (typeof message !== "string" || !message.trim() || message.length > 500) {
    return res.status(400).json({ error: "message 는 1~500자 문자열이어야 합니다." });
  }

  // 대화 기록은 최근 10개의 짧은 텍스트만 받는다(비용·남용 방지). Gemini 는 assistant 대신 model 을 쓴다.
  const past = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-10)
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content.slice(0, 2000) }] }));
  const contents = [...past, { role: "user", parts: [{ text: message }] }];

  const steps = [];            // 에이전트가 부른 도구 기록
  const spots = new Map();     // find_spots 가 돌려준 장소(이름 기준)

  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const data = await callGemini(contents);
      const content = data.candidates && data.candidates[0] && data.candidates[0].content;
      if (!content || !content.parts) {
        const why = (data.promptFeedback && data.promptFeedback.blockReason) || (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || "빈 응답";
        throw new Error(`Gemini 가 답을 만들지 못했습니다(${why}).`);
      }
      contents.push(content);   // 받은 그대로 되돌려 보내야 한다(생각 서명 포함)

      const calls = content.parts.filter((p) => p.functionCall);
      if (!calls.length) {
        const text = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n");
        return res.status(200).json({ reply: text, steps, spots: [...spots.values()] });
      }

      const responses = await Promise.all(
        calls.map(async ({ functionCall: call }) => {
          const fn = handlers[call.name];
          let out;
          try {
            out = fn ? await fn(call.args || {}) : { error: `알 수 없는 도구: ${call.name}` };
          } catch (e) {
            out = { error: String(e.message || e) };
          }
          steps.push({ name: call.name, input: call.args || {}, ok: !out.error });
          if (call.name === "find_spots" && out.spots) out.spots.forEach((s) => spots.set(s.name, s));
          return { functionResponse: { name: call.name, response: out } };
        })
      );
      contents.push({ role: "user", parts: responses });
    }
    res.status(500).json({ error: "도구 호출이 너무 길어져 중단했습니다.", steps });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e), steps });
  }
};
