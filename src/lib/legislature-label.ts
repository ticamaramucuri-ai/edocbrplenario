export function legislatureLabel(number: number | null, startYear: number, endYear: number): string {
  return number === null ? `Legislatura ${startYear}–${endYear}` : `${number}ª Legislatura`
}
