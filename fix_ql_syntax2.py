#!/usr/bin/env python3
with open('/Users/jrz/Desktop/SMM_Agent/frontend/src/pages/QuoteList.tsx', 'r') as f:
    lines = f.readlines()

# The issue: each of these lines ends with: ...'`} } >  (backtick, brace, brace, >)
# That means there's an EXTRA closing brace before the >
# Fix: remove ONE of the two closing braces
# Correct ending: ...'`} >  (backtick, brace, >)

# Fix pattern: replace the 4-byte sequence `}`}`>` with `}`>`
# Bytes: backtick(0x60) close_brace(0x7D) close_brace(0x7D) greater_than(0x3E)
# Target: backtick(0x60) close_brace(0x7D) greater_than(0x3E)

# For each problematic line, fix the ending
for idx in [115, 119, 140, 227]:
    line = lines[idx]
    # Find the pattern `}`}`> at end
    if line.rstrip().endswith("`}}>`"):
        # Replace `}}>` with `}>`
        lines[idx] = line[:-4] + '}>' + '\n'
        print(f"Fixed line {idx+1}")

# Also fix line 119 specifically - it has the closing `}` in wrong position
# line 119: `}`}>  -> `}>` (remove the second `}`)

with open('/Users/jrz/Desktop/SMM_Agent/frontend/src/pages/QuoteList.tsx', 'w') as f:
    f.writelines(lines)

# Verify
with open('/Users/jrz/Desktop/SMM_Agent/frontend/src/pages/QuoteList.tsx', 'r') as f:
    lines2 = f.readlines()
print("\nVerification:")
for i in [115, 119, 140, 227]:
    print(f"  Line {i+1}: {repr(lines2[i][-30:])}")
