# Fonction serveur « swift-api » — version 2 (V13)

Fichier source : supabase/functions/swift-api/index.ts (déployé dans le projet de production, version 2, verify_jwt = true).

Nouveauté : action « reset_password » réservée à l'administrateur du district.
- Corps : { "reset_password": { "user_id": "<uuid>" } }
- Refuse le compte de l'administrateur lui-même.
- Génère un mot de passe provisoire de 20 caractères, l'affiche une seule fois à l'administrateur, et marque le profil « must_change_password ».
- Limite connue : les sessions déjà ouvertes sur un autre appareil restent valables jusqu'à leur expiration. Pour les couper immédiatement, désactiver le compte puis le réactiver (écran Comptes).

Action « create » (inchangée) : création de comptes par lots de 18 au plus.

Aucun secret n'est présent dans le code : les clés sont lues dans l'environnement du serveur.
