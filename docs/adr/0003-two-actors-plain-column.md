# Exactly two actors, stored as a plain checked column

Actors are `agent` and `you`, stored as text with a CHECK constraint, rather than a users table. There is one human, and all agents share one identity. A token maps to one actor and stamps every write. Adding named agents later is a small migration, which is cheaper than modelling users now.
