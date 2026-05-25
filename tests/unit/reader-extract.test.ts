// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readerExtract } from '@electron/services/readerExtract';

const ARTICLE = `<!doctype html><html lang="en">
<head><title>Mars Lander Touches Down</title></head>
<body>
  <header><nav>Site Nav · Sign In · About</nav></header>
  <article>
    <h1>Mars Lander Touches Down</h1>
    <p class="byline">By A. Reporter</p>
    <p>After a six-month journey through deep space, the Horizon-1 lander
       touched down on the rust-coloured plains of Utopia Planitia this morning.
       The vehicle confirmed nominal status within minutes of landing and began
       relaying images of its surroundings to mission control.</p>
    <p>The mission is the first of three planned over the next decade to
       characterise the planet's subsurface ice deposits, considered the most
       likely source of water for future crewed missions.</p>
    <p>Project lead Dr. M. Patel called the touchdown "the smoothest landing
       we've ever simulated, let alone executed."</p>
  </article>
  <footer><div class="comments">Comment from RandomUser</div></footer>
</body></html>`;

describe('readerExtract', () => {
  it('returns the article title and a substantial textContent', () => {
    const a = readerExtract(ARTICLE, 'https://example.com/mars');
    expect(a).not.toBeNull();
    expect(a!.title.toLowerCase()).toContain('mars lander');
    expect(a!.textContent.length).toBeGreaterThan(200);
    expect(a!.readingMinutes).toBeGreaterThanOrEqual(1);
  });

  it('strips the nav/footer noise from textContent', () => {
    const a = readerExtract(ARTICLE, 'https://example.com/mars');
    expect(a!.textContent).not.toMatch(/Sign In/);
    expect(a!.textContent).not.toMatch(/RandomUser/);
  });

  it('returns null on pages without article-shaped content', () => {
    const a = readerExtract('<html><body><div></div></body></html>', 'https://example.com');
    expect(a).toBeNull();
  });
});
