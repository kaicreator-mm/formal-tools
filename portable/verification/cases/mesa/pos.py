import mesa


class Ticker(mesa.Model):
    def __init__(self, seed=None):
        super().__init__(seed=seed)
        self.ticks = 0

    def step(self):
        self.ticks += 1
        self.agents.shuffle_do("advance")


class TickAgent(mesa.Agent):
    def advance(self):
        pass


m = Ticker(seed=42)
TickAgent(m)
for _ in range(3):
    m.step()
assert m.ticks == 3, m.ticks
print("PYVERIFY: OK STEPS=%d" % m.ticks)
