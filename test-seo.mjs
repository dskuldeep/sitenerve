import SeoAnalyzer from 'seo-analyzer';

async function testSeo() {
  const analyzer = new SeoAnalyzer();
  const url = 'https://example.com';

  console.log(`Testing SEO Analyzer on ${url}...`);

  analyzer
    .inputUrls([url])
    .addRule('titleLengthRule', { min: 10, max: 50 })
    .addRule('metaBaseRule', { list: ['description', 'viewport'] })
    .addRule('metaSocialRule', { properties: ['og:url', 'og:type', 'og:site_name', 'og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:image', 'twitter:title', 'twitter:description'] })
    .addRule('imgTagWithAltAttributeRule')
    .addRule('aTagWithRelAttributeRule')
    .addRule('canonicalLinkRule')
    .outputJson(console.log);
  
  await analyzer.run();
}

testSeo();
