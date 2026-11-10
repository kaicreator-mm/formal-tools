import simpy

events = []


def worker(env):
    while True:
        yield env.timeout(1)
        events.append(env.now)


env = simpy.Environment()
env.process(worker(env))
env.run(until=5)
assert events == [1, 2, 3, 4], events
print("PYVERIFY: OK SIMULATED %d events" % len(events))
