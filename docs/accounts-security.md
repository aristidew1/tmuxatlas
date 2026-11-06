# Limites de sécurité des comptes

Tous les utilisateurs d’Atlas partagent le compte Unix du serveur. Les filtres
éventuels de l’interface et de l’API ne constituent pas une isolation Unix :
une personne disposant d’un terminal peut lire les fichiers accessibles à ce
compte et modifier les options tmux, notamment `@atlas-owner`. Pour une
isolation réelle, utiliser des comptes et des environnements Unix distincts.
