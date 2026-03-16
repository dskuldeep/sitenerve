import { analyzeHtml } from '@rumenx/seo';

async function testSeo() {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Test Page</title>
      </head>
      <body>
        <h1>Test</h1>
        <img src="test.jpg" />
        <a href="https://example.com">Link</a>
      </body>
    </html>
  `;
  
  const result = await analyzeHtml(html, 'https://example.com');
  console.log(JSON.stringify(result, null, 2));
}

testSeo();
