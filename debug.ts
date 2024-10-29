import axios from 'axios';
import { InstagramScraper } from './src';

async function debugScraper(): Promise<void> {
  try {
    console.log('Iniciando teste detalhado...');

    const scraper = new InstagramScraper({
      minDelay: 0,
      maxDelay: 0,
    });

    // Fazer requisição direta para ver a resposta do Instagram
    const response = await axios.get('https://www.instagram.com/instagram/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Instagram 269.0.0.18.75',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    console.log('\n=== Status da Resposta ===');
    console.log('Status:', response.status);
    console.log('Headers:', JSON.stringify(response.headers, null, 2));

    console.log('\n=== Primeiros 1000 caracteres do HTML ===');
    console.log(response.data.substring(0, 1000));

    console.log('\n=== Buscando scripts no HTML ===');
    const scriptMatch: RegExpMatchArray | null = response.data.match(
      /<script[^>]*>([^<]+)<\/script>/g
    );
    if (scriptMatch) {
      console.log(`Encontrados ${scriptMatch.length} scripts`);
      console.log('\nPrimeiros 3 scripts:');
      scriptMatch.slice(0, 3).forEach((script: string, index: number) => {
        console.log(`\nScript ${index + 1}:`);
        console.log(script.substring(0, 200) + '...');
      });

      // Vamos procurar especificamente por dados do Instagram
      const sharedDataScript = scriptMatch.find((script: string) =>
        script.includes('window._sharedData')
      );

      if (sharedDataScript) {
        console.log('\n=== Encontrado script com _sharedData ===');
        console.log(sharedDataScript.substring(0, 500) + '...');
      } else {
        console.log('\nNão foi encontrado script com _sharedData');
      }
    } else {
      console.log('Nenhum script encontrado');
    }

    // Vamos também procurar por outras possíveis fontes de dados
    console.log('\n=== Procurando por outras fontes de dados ===');
    const alternativePatterns = [
      'window.__additionalDataLoaded',
      'window.__initialData',
      '<script type="application/ld+json"',
      'data-page-id',
    ];

    alternativePatterns.forEach((pattern: string) => {
      if (response.data.includes(pattern)) {
        console.log(`Encontrado padrão: ${pattern}`);
        // Mostrar um pouco do contexto ao redor do padrão
        const index = response.data.indexOf(pattern);
        const context = response.data.substring(
          Math.max(0, index - 100),
          Math.min(response.data.length, index + 300)
        );
        console.log('Contexto:', context);
      }
    });

    // Tentar a requisição normal do scraper
    console.log('\n=== Tentando scraper normal ===');
    const result = await scraper.getPosts('instagram');
    console.log('Resultado:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n=== Erro durante o teste ===');
    if (axios.isAxiosError(error)) {
      console.error('Erro do Axios:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers,
        data: error.response?.data
          ? error.response.data.substring(0, 1000)
          : null,
      });
    } else {
      console.error('Erro:', error);
    }
  }
}

// Executar o teste
debugScraper().catch(console.error);
