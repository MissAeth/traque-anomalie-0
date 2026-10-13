/**
 * Logique pure de la pioche (aucune dépendance à Foundry, testable seule).
 */

export const AMORCE_BIS = "amorce-bis";

function melanger(liste, rng = Math.random) {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Construit la pile de pioche ordonnée : phase par phase, mélangée à l'intérieur
 * des phases marquées "melanger", en appliquant les règles 3 / 4 / 5 joueurs.
 * @returns {(number|string)[]} numéros de cartes (et éventuellement AMORCE_BIS)
 */
export function construirePioche(donnees, nbJoueurs, rng = Math.random) {
  const regles = donnees.reglesNombreJoueurs?.[String(nbJoueurs)] ?? {};
  const retirer = new Set(regles.retirer ?? []);
  const uneParActe = new Set(regles.retirerUneParActe ?? []);
  const pile = [];

  for (const phase of donnees.phases) {
    let ids = donnees.cartes
      .filter(c => c.phase === phase.id && !retirer.has(c.numero))
      .map(c => c.numero);
    if (uneParActe.has(phase.id) && ids.length) {
      ids.splice(Math.floor(rng() * ids.length), 1);
    }
    if (phase.melanger) ids = melanger(ids, rng);
    pile.push(...ids);
    if (phase.id === "miseEnPlace" && regles.amorceBis) pile.push(AMORCE_BIS);
  }
  return pile;
}

export function phaseDe(donnees, entree) {
  if (entree === AMORCE_BIS) return "miseEnPlace";
  return donnees.cartes.find(c => c.numero === entree)?.phase ?? null;
}

export function indexPhase(donnees, phaseId) {
  return donnees.phases.findIndex(p => p.id === phaseId);
}
