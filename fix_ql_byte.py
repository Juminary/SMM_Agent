#!/usr/bin/env python3
with open('/Users/jrz/Desktop/SMM_Agent/frontend/src/pages/QuoteList.tsx', 'rb') as f:
    content = f.read()

# Current: all 4 lines end with backtick + brace + brace + greater_than
# That's: 0x60 0x7D 0x7D 0x3E
# Target: 0x60 0x7D 0x3E (remove one brace)

# Fix: replace the 4-byte sequence `}}>` with `}> 
# That is: 0x60 0x7D 0x7D 0x3E -> 0x60 0x7D 0x3E

# But the lines might not end with newline, so the pattern is at the end of the file
# or within lines. Let me find each occurrence of `}}` followed by `>` at line ends.

lines = content.split(b'\n')
print("Before:")
for i in [115, 119, 140, 227]:
    print(f"  Line {i+1} last 10 bytes: {lines[i][-10:]}")

# Fix each line
for i in [115, 119, 140, 227]:
    line = lines[i]
    # Replace the last 4 bytes `}}>` with `}>
    if line.endswith(b'}}`'):
        print(f"  Line {i+1} ends with `}}>` - need to check further")
    # The last bytes are: 0x60 0x7D 0x7D 0x3E (backtick, close_brace, close_brace, >)
    # We need: 0x60 0x7D 0x3E (backtick, close_brace, >)
    if len(line) >= 4 and line[-4:] == b'}}`':
        print(f"  Line {i+1} ends with `}}` - checking...")
    if line[-4:] in [b'}}`', b'}}>', b'}`}>', b'`}>']:
        print(f"  Line {i+1}: found pattern {line[-4:]}")

# Let me just do a targeted search for the pattern at specific line positions
# and replace it
for i in [115, 119, 140, 227]:
    line = lines[i]
    last4 = line[-4:]
    print(f"Line {i+1}: last4 = {list(last4)} (0x{last4[0]:02x} 0x{last4[1]:02x} 0x{last4[2]:02x} 0x{last4[3]:02x})")
