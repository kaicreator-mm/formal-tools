import simpy

# A negative timeout delay must fail rather than silently advance time.
simpy.Environment().timeout(-1)
