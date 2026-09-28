export function lessonDraft({ startsAt, durationMinutes }) {
  const date = new Date(startsAt);
  return {
    date,
    time: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
    durationMinutes,
  };
}

export function batchDateValue(date) {
  return date;
}
