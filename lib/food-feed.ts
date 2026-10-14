type Row = Record<string, any>;
export type FoodPage = {posts: Row[]; total: number; nextOffset: number | null};

/** Re-read the displayed range so polling neither loses pages nor keeps expired rows. */
export async function readFoodPages(load: (offset: number) => Promise<FoodPage>, desired = 40): Promise<FoodPage> {
  const posts: Row[] = [], seen = new Set<string>();
  let offset = 0, total = 0, nextOffset: number | null = null;
  do {
    const page = await load(offset);
    if (!Array.isArray(page.posts) || !Number.isSafeInteger(page.total) || page.total < 0 ||
      (page.nextOffset !== null && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset))) {
      throw new Error('Food alerts could not be refreshed. Please try again.');
    }
    for (const post of page.posts) {
      if (typeof post.id !== 'string') throw new Error('An incomplete food alert was received. Please refresh.');
      if (!seen.has(post.id)) { seen.add(post.id); posts.push(post); }
    }
    total = page.total; nextOffset = page.nextOffset;
    if (nextOffset === null || nextOffset >= desired) break;
    offset = nextOffset;
  } while (true);
  return {posts, total, nextOffset};
}
