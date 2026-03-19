const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const FIRMA_KEY = 'firma_7568f96c93fb42f1811abc08153302456388faa366a5f44d';
const MONDAY_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYzNDI5OTgzNSwiYWFpIjoxMSwidWlkIjoyOTM2NzEyNiwiaWFkIjoiMjAyNi0wMy0xN1QxNzowOTo1Ny45NjRaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTE3Mjk2MzMsInJnbiI6InVzZTEifQ.oPYF0k3V2mlZ8MC7iVt2bh2kLkus8cFmfUSh33UnNvw';
const RESEND_KEY = 're_8JYnuAAm_HCbGN7ettZ2AjUAXNGMvBZdL';

app.get('/', (req, res) => {
  res.json({ status: 'DJ Shark Attack server is running!' });
});

function textToPdfBase64(text) {
  const lines = text.split('\n');
  const pageHeight = 792;
  const pageWidth = 612;
  const margin = 50;
  const lineHeight = 13;
  const fontSize = 9;
  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);

  const pdfLines = [];
  for (const line of lines) {
    if (line.length === 0) { pdfLines.push(''); continue; }
    for (let i = 0; i < line.length; i += 95) pdfLines.push(line.slice(i, i + 95));
  }

  const pages = [];
  for (let i = 0; i < pdfLines.length; i += linesPerPage) pages.push(pdfLines.slice(i, i + linesPerPage));
  if (pages.length === 0) pages.push(['']);

  let objId = 1;
  const objs = {};
  const catalogId = objId++;
  const pagesId = objId++;
  objs[objId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const fontId = objId++;

  const pageIds = [];
  for (const pageLines of pages) {
    const esc = pageLines.map(l => l.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/\r/g,''));
    let s = `BT\n/F1 ${fontSize} Tf\n${margin} ${pageHeight - margin} Td\n${lineHeight} TL\n`;
    for (const l of esc) s += `(${l}) Tj T*\n`;
    s += 'ET';
    objs[objId] = `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
    const cid = objId++;
    objs[objId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    pageIds.push(objId++);
  }

  objs[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId] = `<< /Type /Pages /Kids [${pageIds.map(i=>`${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const maxId = objId - 1;
  let pdf = '%PDF-1.4\n';
  const offsets = {};
  for (let i = 1; i <= maxId; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxId; i++) pdf += offsets[i].toString().padStart(10,'0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString('base64');
}

app.post('/send-contract', async (req, res) => {
  try {
    const { clientName, pocName, pocEmail, contractText, emailMessage, perfDate, agDate, startTime, endTime, venue, fee, services } = req.body;
    if (!pocEmail) return res.status(400).json({ error: 'Missing pocEmail' });
    if (!contractText) return res.status(400).json({ error: 'Missing contractText' });

    const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const dep = fee ? '$' + (parseFloat(fee) * 0.5).toFixed(2) : '';

    // Pre-fill contract
    let filled = contractText;
    filled = filled.replace('DJ Shark Attack LLC Representative: _______________', 'DJ Shark Attack LLC Representative: Daniel Moore');
    filled = filled.replace(/DJ Shark Attack LLC Representative: Daniel Moore\nSignature: _+/, 'DJ Shark Attack LLC Representative: Daniel Moore\nSignature: /s/ Daniel Moore');
    filled = filled.replace(/Date: _+/g, 'Date: ' + today);

    const pdfBase64 = textToPdfBase64(filled);

    console.log('Sending email to', pocEmail);
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'DJ Shark Attack LLC <onboarding@resend.dev>',
        to: [pocEmail],
        reply_to: 'djsharkattack@yahoo.com',
        subject: `DJ Shark Attack Service Contract - ${clientName}`,
        text: emailMessage,
        attachments: [{
          filename: `DJ_Shark_Attack_Contract_${clientName.replace(/[^a-z0-9]/gi,'_')}.pdf`,
          content: pdfBase64
        }]
      })
    });
    const emailData = await emailRes.json();
    console.log('Resend response:', JSON.stringify(emailData));
    if (!emailRes.ok) throw new Error('Resend error: ' + JSON.stringify(emailData));

    console.log('Email sent to', pocEmail);
    res.json({ success: true });

  } catch (e) {
    console.error('send-contract error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/log-monday', async (req, res) => {
  try {
    const { boardId, itemName, eventDate, services, venue, contactInfo, phone, fee, deposit } = req.body;

    const servicesMap = {
      'Ceremony and reception': ['Ceremony', 'Reception'],
      'Reception only': ['Reception'],
      'Hourly': ['Hourly']
    };
    const mondayServices = servicesMap[services] || [services];

    const colObj = {};
    if (eventDate) colObj['date'] = { date: eventDate };
    if (mondayServices.length) colObj['dropdown'] = { labels: mondayServices };
    if (venue) colObj['text_mm1hgkk7'] = venue;
    if (contactInfo) {
      const parts = contactInfo.split(' | ');
      const pocName = parts[0] || '';
      const pocEmail = parts[1] || contactInfo;
      colObj['text_1'] = pocEmail;
      colObj['text'] = pocName + (phone ? ' - ' + phone : '');
    }
    if (fee) colObj['payment_method'] = '$' + fee + ' DUE';
    colObj['status'] = { label: 'Done' };
    colObj['status_2'] = { label: 'Done' };
    colObj['status6'] = { label: 'Not Received' };
    colObj['status_1'] = { label: 'Send' };

    const colVals = JSON.stringify(colObj);
    console.log('Monday column values:', colVals);

    const mutation = `mutation {
      create_item(
        board_id: ${boardId},
        item_name: "${itemName.replace(/"/g,'').replace(/\n/g,' ').replace(/ - \d{2}\/\d{2}\/\d{4}/,'')}",
        column_values: ${JSON.stringify(colVals)}
      ) { id }
    }`;

    const monRes = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_TOKEN,
        'API-Version': '2024-01'
      },
      body: JSON.stringify({ query: mutation })
    });

    const monData = await monRes.json();
    console.log('Monday response:', JSON.stringify(monData));

    if (monData.data && monData.data.create_item) {
      res.json({ success: true, id: monData.data.create_item.id });
    } else {
      res.status(400).json({ error: 'Monday error', detail: monData });
    }
  } catch (e) {
    console.error('log-monday error:', e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('DJ Shark Attack server running on port ' + PORT));
