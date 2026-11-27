/** Short display name of a company: drops "Ltd", "Pvt", "Private", "Limited", "Corporation of India". */
export const shortName = (name = '') =>
  name.replace(/\b(Corporation of India|Limited|Ltd\.?|Pvt\.?|Private)\b/gi, '').replace(/\s+/g, ' ').trim();
