import locationData from "../data/nepalEducationFacilities.json" with { type: "json" };

type District = { name: string; localLevels: string[] };
type Province = { name: string; districts: District[] };

export const NEPAL_PROVINCES = locationData.provinces as Province[];

/** Province and district are controlled facts. Municipality and institution may be manual. */
export function validNepalProvinceDistrict(province: string, district: string): boolean {
  return NEPAL_PROVINCES.some(
    (candidate) => candidate.name === province
      && candidate.districts.some((item) => item.name === district),
  );
}

export function listedLocalLevel(province: string, district: string, localLevel: string): boolean {
  return NEPAL_PROVINCES
    .find((candidate) => candidate.name === province)
    ?.districts.find((candidate) => candidate.name === district)
    ?.localLevels.includes(localLevel) === true;
}
