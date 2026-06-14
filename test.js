require('dotenv').config();

async function askAI(prompt) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-8b-instruct:free',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await response.json();
  if (!data.choices) throw new Error(JSON.stringify(data));
  return data.choices[0].message.content.trim();
}

askAI('say hello').then(console.log).catch(console.error);