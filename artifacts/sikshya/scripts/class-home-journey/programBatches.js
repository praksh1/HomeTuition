export function lessonDraft({ startsAt, durationMinutes }) {
  const date = new Date(startsAt);
  return {
    date,
    time: date.toISOString().slice(11, 16),
    durationMinutes,
  };
}

export function batchDateValue(date) {
  return date;
}
