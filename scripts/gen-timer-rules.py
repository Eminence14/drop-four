"""Regenerates the timer-related parts of database.rules.json (kept as code so the long
# NOTE: one-shot generator; it was run once on top of the v1.1 rules. Edit database.rules.json directly now.
expressions stay correct). Run: python3 scripts/gen-timer-rules.py"""
import json

r = json.load(open('database.rules.json'))
room = r['rules']['rooms']['$code']

def O(p):  # OLD value at room-relative path
    return f"root.child('rooms/' + $code + '/{p}')"

def N(p, depth):  # NEW value; depth = how many levels below the room the rule node is
    return 'newData' + '.parent()' * depth + f".child('{p}')"

def D(depth):  # OLD node at room level via data
    return 'data' + '.parent()' * depth

isPlayer = f"(auth != null && ({O('players/p1/uid')}.val() === auth.uid || {O('players/p2/uid')}.val() === auth.uid))"
E = f"(!{O('moves')}.exists() || {O('moves')}.val().length % 2 === 0)"
FP = f"{O('firstPlayer')}.val()"
turnP1 = f"(({E} && {FP} === 'p1') || (!{E} && {FP} === 'p2'))"

def turnSeatIs(x):
    return f"(({turnP1} && {x} === 'p1') || (!{turnP1} && {x} === 'p2'))"

def bank(s):
    return O(f'bank/{s}')

T = O('turnAt')
def expiredFor(s):
    return (f"({T}.exists() && (({O('timer/kind')}.val() === 'move' && now > {T}.val() + {O('timer/ms')}.val()) || "
            f"({O('timer/kind')}.val() === 'bank' && (({bank(s)}.val() > 0 && now > {T}.val() + {bank(s)}.val()) || ({bank(s)}.val() <= 0 && now > {T}.val() + 5000)))))")
expiredTurn = f"(({turnP1} && {expiredFor('p1')}) || (!{turnP1} && {expiredFor('p2')}))"

def nextGame(depth):
    return f"{N('gameNumber', depth)}.val() === {D(depth)}.child('gameNumber').val() + 1"

def strikeInc(s, depth):
    old = O(f'strikes/{s}')
    new = N(f'strikes/{s}', depth)
    return f"((!{old}.exists() && {new}.val() === 1) || ({old}.exists() && {new}.val() === {old}.val() + 1))"

# ---- moves: normal turn OR auto-timeout claim; timed games must stamp turnAt and deduct bank
mv = room['moves']
v = mv['.validate']
head, turn = v.split(" && !newData.parent().child('forfeit').exists() && ", 1) if "forfeit" in v else v.split(' && ((((((!data.exists()', 1)
if 'forfeit' not in v:
    turn = '((((((!data.exists()' + turn
else:
    # strip previously generated timeout branch
    turn = turn[turn.index('|| (((((!data.exists()') + 3:]
    turn = '(' + turn
timeout_branch = (f"({N('timer/onTimeout', 1)}.val() === 'auto' && {expiredTurn} && "
                  f"(({turnP1} && {strikeInc('p1', 1)}) || (!{turnP1} && {strikeInc('p2', 1)})))")
bank_rule = (f"(!{N('timer', 1)}.exists() || {N('timer/kind', 1)}.val() !== 'bank' || !{T}.exists() || "
             f"({turnP1} && ({bank('p1')}.val() <= 0 || {N('bank/p1', 1)}.val() <= {bank('p1')}.val() - (now - {T}.val()) + 2000)) || "
             f"(!{turnP1} && ({bank('p2')}.val() <= 0 || {N('bank/p2', 1)}.val() <= {bank('p2')}.val() - (now - {T}.val()) + 2000)))")
stamp_rule = f"(!{N('timer', 1)}.exists() || {N('turnAt', 1)}.val() === now)"
mv['.validate'] = (f"{head} && !{N('forfeit', 1)}.exists() && {stamp_rule} && {bank_rule} && ({timeout_branch} || {turn})")

room.pop('deadline', None)
room['turnAt'] = {
    '.write': f"{isPlayer} && (newData.exists() || {nextGame(1)})",
    '.validate': (f"newData.isNumber() && newData.val() === now && {N('timer', 1)}.exists() && "
                  f"(!data.exists() || {N('moves', 1)}.val() !== {D(1)}.child('moves').val() || {nextGame(1)})"),
}
room['bank'] = {
    '.write': f"{isPlayer} && (newData.exists() || {nextGame(1)})",
    '$seat': {
        '.write': f"{isPlayer} && newData.exists()",
        '.validate': ("($seat === 'p1' || $seat === 'p2') && newData.isNumber() && newData.val() >= 0 && newData.val() <= 600000 && ("
                      "!data.exists() || "
                      f"({nextGame(2)} && newData.val() === {N('timer/ms', 2)}.val()) || "
                      f"({N('moves', 2)}.val() !== {D(2)}.child('moves').val() && {turnSeatIs('$seat')} && newData.val() <= data.val()))"),
    },
}
room['strikes'] = {
    '.write': f"{isPlayer} && !newData.exists() && {nextGame(1)}",
    '$seat': {
        '.write': f"{isPlayer} && newData.exists()",
        '.validate': ("($seat === 'p1' || $seat === 'p2') && newData.isNumber() && "
                      "((!data.exists() && newData.val() === 1) || (data.exists() && newData.val() === data.val() + 1)) && "
                      f"{turnSeatIs('$seat')} && {expiredTurn} && "
                      f"({N('moves', 2)}.val() !== {D(2)}.child('moves').val() || {N('forfeit', 2)}.val() === $seat)"),
    },
}
room['forfeit'] = {
    '.write': f"{isPlayer} && (newData.exists() || {nextGame(1)})",
    '.validate': ("!data.exists() && (newData.val() === 'p1' || newData.val() === 'p2') && "
                  f"{O('status')}.val() === 'playing' && {turnSeatIs('newData.val()')} && {expiredTurn} && "
                  f"({O('timer/onTimeout')}.val() === 'lose' || {N('strikes', 1)}.child(newData.val()).val() >= 3)"),
}
room['status']['.validate'] = ("(!data.exists() && newData.val() === 'waiting') || "
                               f"(newData.val() === 'playing' && {N('players/p2', 1)}.exists())")
sc = room['score']
sc['.validate'] = ("newData.hasChildren(['p1', 'p2', 'draws']) && (!data.exists() || "
                   f"({nextGame(1)} && newData.child('p1').val() >= data.child('p1').val() && newData.child('p2').val() >= data.child('p2').val() && "
                   "newData.child('draws').val() >= data.child('draws').val() && "
                   "newData.child('p1').val() + newData.child('p2').val() + newData.child('draws').val() === "
                   "data.child('p1').val() + data.child('p2').val() + data.child('draws').val() + 1))")
# players: optional avatar
for p in ('p1', 'p2'):
    room['players'][p]['avatar'] = {'.validate': 'newData.isString() && newData.val().length <= 16'}
# p2 may update own name/avatar? keep immutable for simplicity.

json.dump(r, open('database.rules.json', 'w'), indent=2)

def check(o, path=''):
    if isinstance(o, dict):
        for k, val in o.items():
            check(val, path + '/' + k)
    elif isinstance(o, str) and path.rsplit('/', 1)[-1] in ('.read', '.write', '.validate'):
        d = 0
        for ch in o:
            d += ch == '('
            d -= ch == ')'
            assert d >= 0, path
        assert d == 0, path
check(r)
print('rules ok, bytes', len(json.dumps(r)))
