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

// Claude 에 넘길 도구 설명
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
];

// 도구 이름 → 실행 함수
const handlers = { find_spots };

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
module.exports = Object.assign(handler, { find_spots, tools, handlers });
