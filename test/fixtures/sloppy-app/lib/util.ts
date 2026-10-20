// @ts-ignore
export function parse(value: any) {
  try {
    return JSON.parse(value);
  } catch {}
}

export async function load() {
  const response = await fetch('http://api.example.com/data');
  return response.json();
}
