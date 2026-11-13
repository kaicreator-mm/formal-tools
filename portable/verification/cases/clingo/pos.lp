% Positive: 2-colorable graph -> SATISFIABLE with answer sets
{ color(X,red); color(X,blue) } = 1 :- node(X).
:- color(X,C), color(Y,C), edge(X,Y).
node(a). node(b). node(c).
edge(a,b). edge(b,c).
#show color/2.
