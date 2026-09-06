export interface TeacherPage<T> {
  teachers: T[];
  total: number;
  page: number;
  limit: number;
}

/** Discover filters locally: it must load every server page before declaring no match. */
export async function loadTeacherDirectory<T extends { userId: number }>(
  get: (path: string) => Promise<TeacherPage<T>>,
): Promise<{ teachers: T[]; total: number }> {
  const first = await get('/teachers?limit=100&page=1');
  const rows = new Map(first.teachers.map((teacher) => [teacher.userId, teacher]));
  const pages = Math.ceil(first.total / first.limit);
  for (let page = 2; page <= pages; page++) {
    const next = await get(`/teachers?limit=${first.limit}&page=${page}`);
    for (const teacher of next.teachers) rows.set(teacher.userId, teacher);
  }
  return { teachers: [...rows.values()], total: first.total };
}
