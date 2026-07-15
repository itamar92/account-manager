const fs = require('fs');
const parser = require('./vendor-parsers/delek-ocr.js');

const text = fs.readFileSync('./temp-invoice-text.txt', 'utf8');
const result = parser(text, '{{ $json.id }}', '{{ $json.threadId }}');
console.log(JSON.stringify(result, null, 2));
