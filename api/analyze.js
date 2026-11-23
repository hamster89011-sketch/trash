export default async function handler(req, res) {
  // CORS 허용 설정 (필요시 특정 도메인으로 제한 가능)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: '서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  try {
    const { description, base64Image, mimeType, csvHint } = req.body || {};

    if (!description && !base64Image) {
      return res.status(400).json({ error: '품목 설명 또는 사진 데이터가 필요합니다.' });
    }

    const csvReferenceText = csvHint
      ? `\n[원주시 공식 CSV 수수료표 일치 항목]\n- 품목/규격: ${csvHint.category}\n- 공식 수수료: ${csvHint.fee}\n- 동일 품목 규격 목록: ${(csvHint.relatedSpecs || []).map(s => `${s.spec}(${s.feeNum}원)`).join(', ')}\n위 공식 CSV 기준표 금액을 최우선으로 반영해 정확히 안내하세요.`
      : '';

    const systemPrompt = `당신은 강원특별자치도 원주시 대형폐기물 배출 안내 AI입니다.
사용자의 사진과 설명을 분석해 원주시 대형폐기물 수수료 기준에 맞춰 JSON으로만 응답하세요.${csvReferenceText}
대형 폐가전(냉장고, 세탁기, 에어컨, TV 등)은 원형이 훼손되지 않은 경우 무상방문수거(0원) 대상임을 안내하세요.
JSON 스키마:
{
  "category": "추정 품목명 및 규격",
  "fee": "예상 수수료 (예: 20,000원)",
  "guide": "원주시 기준 배출 방법 (2문장 이내)"
}`;

    const userParts = [
      {
        text: description
          ? `설명: ${description}`
          : '첨부된 사진의 대형폐기물 품목, 원주시 예상 수수료, 배출 방법을 알려주세요.'
      }
    ];

    if (base64Image && mimeType) {
      userParts.push({
        inlineData: {
          mimeType,
          data: base64Image
        }
      });
    }

    const payload = {
      contents: [{ role: 'user', parts: userParts }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            category: { type: 'STRING' },
            fee: { type: 'STRING' },
            guide: { type: 'STRING' }
          },
          required: ['category', 'fee', 'guide']
        }
      }
    };

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!geminiRes.ok) {
      const errorDetail = await geminiRes.text();
      console.error('Gemini API Error:', geminiRes.status, errorDetail);
      return res.status(geminiRes.status).json({ error: 'Gemini AI 호출 중 오류가 발생했습니다.' });
    }

    const result = await geminiRes.json();
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(502).json({ error: 'AI 응답 파싱에 실패했습니다.' });
    }

    const parsedData = JSON.parse(rawText);
    return res.status(200).json({
      ...parsedData,
      source: 'Gemini AI 분석'
    });
  } catch (error) {
    console.error('Serverless Function Error:', error);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
}
