import sys
fname = sys.argv[1]
start = int(sys.argv[2])
end = int(sys.argv[3])
with open(fname) as f:
    lines = f.readlines()
for i, l in enumerate(lines[start-1:end], start=start):
    print(f"{i}:{l}", end='')
