const { spots } = require("../jeju_spots.json");

const AREAS = ["동쪽", "서쪽", "서귀포", "제주시"];
const MAX_RESULTS = 8;

// 목록의 area 는 "동쪽(성산)", "서쪽(안덕)" 처럼 괄호가 붙어 있어 앞부분으로 비교한다.
const areaOf = (spot) => spot.area.split("(")[0];

function find_spots({ area, indoor } = {}) {
  if (!AREAS.includes(area)) {
    return { error: `area 는 ${AREAS.join(" · ")} 중 하나여야 합니다.` };
  }
  const found = spots.filter(
    (s) => areaOf(s) === area && (indoor === undefined || s.indoor === indoor)
  );
  return {
    total: found.length,
    spots: found.slice(0, MAX_RESULTS).map((s) => ({
      name: s.name,
      area: s.area,
      indoor: s.indoor,
      description: s.type,
    })),
  };
}

// 지역별 날씨 기준 위치(대표 지점)
const AREA_CENTER = {
  동쪽: [33.46, 126.8],
  서쪽: [33.41, 126.27],
  서귀포: [33.2541, 126.5601],
  제주시: [33.4996, 126.5312],
};

// WMO 날씨 코드 → 한글
const weatherText = (c) =>
  c === 0 ? "맑음" :
  c <= 2 ? "구름 조금" :
  c === 3 ? "흐림" :
  c <= 48 ? "안개" :
  c <= 57 ? "이슬비" :
  c <= 67 ? "비" :
  c <= 77 ? "눈" :
  c <= 82 ? "소나기" :
  c <= 86 ? "소낙눈" : "뇌우";

// Open-Meteo(키 불필요)에서 현재 날씨와 3일 예보를 가져온다.
async function get_weather({ area } = {}) {
  const center = AREA_CENTER[area];
  if (!center) return { error: `area 는 ${AREAS.join(" · ")} 중 하나여야 합니다.` };
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${center[0]}&longitude=${center[1]}` +
    "&current=temperature_2m,precipitation,weather_code,wind_speed_10m" +
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
    "&timezone=Asia%2FSeoul&forecast_days=3";
  const res = await fetch(url);
  if (!res.ok) return { error: `날씨 서비스 오류(${res.status})` };
  const w = await res.json();
  return {
    area,
    now: {
      weather: weatherText(w.current.weather_code),
      temperature_c: w.current.temperature_2m,
      precipitation_mm: w.current.precipitation,
      wind_kmh: w.current.wind_speed_10m,
    },
    forecast: w.daily.time.map((date, i) => ({
      date,
      weather: weatherText(w.daily.weather_code[i]),
      min_c: w.daily.temperature_2m_min[i],
      max_c: w.daily.temperature_2m_max[i],
      rain_probability_pct: w.daily.precipitation_probability_max[i],
    })),
  };
}

// 모델에 넘길 도구 설명
const tools = [
  {
    name: "find_spots",
    description:
      "제주도 관광지 목록(jeju_spots.json)에서 지역과 실내 여부로 장소를 골라 최대 8곳의 이름 · 지역 · 실내 여부 · 설명을 돌려준다. " +
      "목록 밖 장소는 없다. 이 도구가 돌려주지 않은 장소는 추천하거나 지어내지 말고, 결과가 없으면 없다고 답한다.",
    input_schema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: AREAS,
          description: "찾을 지역. 동쪽 · 서쪽 · 서귀포 · 제주시 중 하나.",
        },
        indoor: {
          type: "boolean",
          description: "true 면 실내만, false 면 야외만. 생략하면 둘 다.",
        },
      },
      required: ["area"],
    },
  },
  {
    name: "get_weather",
    description:
      "제주도 지역의 현재 날씨와 오늘부터 3일간의 예보(날씨 · 최저/최고 기온 · 강수확률)를 알려준다. " +
      "날씨에 따라 실내/야외 추천이 달라질 때, 또는 사용자가 날씨나 날짜를 언급할 때 find_spots 전에 부른다. " +
      "제주도 밖 지역은 지원하지 않는다.",
    input_schema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: AREAS,
          description: "날씨를 볼 지역. 동쪽 · 서쪽 · 서귀포 · 제주시 중 하나.",
        },
      },
      required: ["area"],
    },
  },
];

// 도구 이름 → 실행 함수
const handlers = { find_spots, get_weather };

// Vercel 이 /api/tools 로 부르는 함수. GET /api/tools?area=동쪽&indoor=true
function handler(req, res) {
  const { area, indoor } = req.query;
  const result = find_spots({
    area,
    indoor: indoor === undefined || indoor === "" ? undefined : indoor === "true",
  });
  res.status(result.error ? 400 : 200).json(result);
}

// 다른 파일에서 require 해서 쓸 수 있게 함수에 붙여 내보낸다.
module.exports = Object.assign(handler, { find_spots, get_weather, tools, handlers });
