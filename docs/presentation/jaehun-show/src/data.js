/** data/ 폴더의 JSON을 읽는다. 원본 동작은 AI Hub 파생물이라 로컬 전용. */
export async function loadData() {
  const [clips, atlas, tokensMeta] = await Promise.all([
    fetch('data/clips.json').then(r => r.json()),
    fetch('data/atlas.json').then(r => r.json()),
    fetch('data/tokens_meta.json').then(r => r.json()),
  ]);
  return { clips, atlas, tokensMeta };
}
