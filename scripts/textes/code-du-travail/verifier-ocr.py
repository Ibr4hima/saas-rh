import re, sys, difflib, glob
ocr_files, transcript = sys.argv[1], sys.argv[2]
def norm(t):
    t = t.replace('’', "'").replace('‘', "'").replace('`', "'")
    t = t.replace('–', '-').replace('—', '-').replace('«', ' « ').replace('»', ' » ')
    t = t.replace('œ', 'oe').replace('Œ', 'OE')
    t = re.sub(r'\*+', '', t)
    t = re.sub(r'(?m)^%%.*$', '', t)
    t = re.sub(r'(?m)^\s*[-•]\s+', ' ', t)          # puces
    t = re.sub(r'(?m)^\s*\d+\s*$', '', t)            # numéros de page
    t = re.sub(r'[|•]', ' ', t)
    t = re.sub(r'-\n(\w)', r'-\1', t)                # coupures dix-/huit
    t = re.sub(r'\s+([;:,.!?)])', r'\1', t)
    t = re.sub(r'([(])\s+', r'\1', t)
    return t.split()
ocr = ''
for f in sorted(glob.glob(ocr_files)):
    txt = open(f).read()
    # numéro de page imprimé en dernière ligne
    txt = re.sub(r'\n\s*\d{1,3}\s*\n*$', '\n', txt.strip())
    ocr += txt + '\n'
a = norm(ocr); b = norm(open(transcript).read())
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
n = 0
for op, i1, i2, j1, j2 in sm.get_opcodes():
    if op == 'equal': continue
    n += 1
    ctx = ' '.join(b[max(0,j1-6):j1])
    print(f'[{n}] {op:7} OCR: {" ".join(a[i1:i2])!r:45}  MOI: {" ".join(b[j1:j2])!r:45}  … {ctx}')
print('écarts :', n, '| mots OCR', len(a), '| mots transcription', len(b))
