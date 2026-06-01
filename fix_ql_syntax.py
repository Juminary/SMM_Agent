#!/usr/bin/env python3
with open('/Users/jrz/Desktop/SMM_Agent/frontend/src/pages/QuoteList.tsx', 'r') as f:
    content = f.read()

# Fix 4 locations where template literal `}` closes without a `>`
# Pattern: className={`...`}>` (the `}` is the JSX attr close, `>` is the tag close)
# But we have: className={`...'`}>` (missing the `>`)
# OR: className={`...'`}}` (extra backtick)

# 1. Line 116: ends with `'`}}` -> should be `'`}`>
lines = content.split('\n')
print("Before fixes:")
for i in [115, 119, 140, 227]:
    print(f"  Line {i+1}: {repr(lines[i][-50:])}")

# Fix lines with wrong closing patterns:
# Pattern: `'}`  -> `'}>`

# Line 116 (index 115): `'text-gray-400'`}} -> `'text-gray-400'}`
# Line 120 (index 119): `'text-gray-400'}`} -> `'text-gray-400'}`
# Line 141 (index 140): `'`}>` (correct) -> but check the bytes
# Line 228 (index 227): `'`}>` (correct) -> but check the bytes

# The issue: className={`...'`}}` (extra backtick before })
# Fix: replace `'`}}` with `'`}>
for idx in [115, 119, 140, 227]:
    # Check if line ends with the wrong pattern
    line = lines[idx]
    if line.rstrip().endswith("'`}}`"):
        lines[idx] = line.replace("'`}}`", "'}>")
        print(f"  Fixed line {idx+1}: removed extra backtick")
    elif line.rstrip().endswith("'`}`"):
        # May need to add >
        if not line.rstrip().endswith("'`}>`"):
            lines[idx] = line.rstrip() + '>'
            print(f"  Fixed line {idx+1}: added >")
        else:
            print(f"  Line {idx+1}: looks OK")

print("\nAfter fixes:")
for i in [115, 119, 140, 227]:
    print(f"  Line {i+1}: {repr(lines[i][-50:])}")

with open('/Users/jrz/Desktop/SMM_Agent/frontend/src/pages/QuoteList.tsx', 'w') as f:
    f.write('\n'.join(lines))
print("\nDone!")
