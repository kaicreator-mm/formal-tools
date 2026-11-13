% Positive: conjecture follows from the axioms -> Refutation found (PROVED)
fof(ax1, axiom, p(a)).
fof(ax2, axiom, (! [X] : (p(X) => p(f(X))))).
fof(goal, conjecture, p(f(a))).
