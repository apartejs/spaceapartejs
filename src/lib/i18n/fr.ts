/**
 * Le même produit, en français.
 *
 * Ce n'est pas une traduction MOT À MOT : c'est la même intention, écrite comme si elle
 * avait été écrite en français d'abord. Tutoiement, phrases courtes, pas d'anglicisme
 * quand un mot français existe (« aperçu », pas « preview » ; « jeton », pas « token »),
 * et une structure de phrase refaite chaque fois que le calque sonnerait faux.
 *
 * Restent en anglais, volontairement : le nom du produit, « Made with aparté », « Space »
 * et « Hub » (ce sont les noms propres du Hugging Face Hub, pas des mots communs), les
 * identifiants de modèle, les dtypes, les unités d'octets et les chemins de fichiers.
 *
 * Le type vient de l'anglais : `UiCopy` est `typeof en`. Une clé oubliée ici ne passe pas
 * la compilation — c'est tout l'intérêt de l'annotation ci-dessous.
 */

import type { UiCopy } from './en';

export const fr: UiCopy = {
  header: {
    tagline: 'une démo pour ton modèle, en trois clics',
    modelLabel: 'modèle',
    openSpace: 'Ouvrir le Space',
    signedIn: 'Connecté à Hugging Face',
    signOut: 'Se déconnecter',
    // Le chiasme de l'anglais (« built with, and built for ») passe tel quel en français,
    // avec les deux relatives — c'est la phrase qui boucle la boucle du produit.
    madeWith:
      'aparté — la bibliothèque de chat avec laquelle ce produit est fait, et pour laquelle il existe',
    panesLabel: 'Panneau affiché',
    paneChat: 'Chat',
    panePreview: 'Aperçu',
  },

  shell: {
    splitLabel: 'Chat et aperçu',
    dismiss: 'Fermer',
    // « vaut mieux que » plutôt que « mérite mieux que » : c'est la tournure qu'un
    // développeur français emploierait vraiment, et elle est plus courte donc plus dure.
    lede: 'Ton modèle vaut mieux qu’un README.',
    viewLabel: 'vue',
    viewGroup: 'Contenu du panneau',
    viewPreview: 'Aperçu',
    viewFiles: 'Fichiers',
  },

  preview: {
    standby: 'pas de signal',
    emptyTitle: 'Rien à afficher pour l’instant',
    emptyBody:
      'Réponds à deux ou trois questions à gauche : ton Space apparaît ici, en direct.',
    frameTitle: 'Aperçu en direct du Space généré',
    failureTitle: 'Ce Space n’a pas pu être construit',
    updating: 'Mise à jour de l’aperçu',
  },

  previewBar: {
    themeLabel: 'thème',
    themeGroup: 'Thème de l’aperçu',
    themes: {
      light: 'Clair',
      dark: 'Sombre',
      system: 'Système',
    },
    themeOption: (theme: string) => `Afficher l’aperçu avec le thème ${theme.toLowerCase()}`,
    overridden: 'aperçu seul',
    shipsWith: (theme: string) => `Le Space généré reste en thème « ${theme.toLowerCase()} ».`,
    openTab: 'Ouvrir dans un onglet',
    openTabHint:
      'L’aperçu tourne en bac à sable : le modèle ne peut être téléchargé et exécuté que dans un vrai onglet',
  },

  files: {
    tabsLabel: 'Fichiers générés',
    copy: 'Copier',
    copied: 'Copié',
    copyFailed: 'Copie impossible — sélectionne le texte à la main',
    copiedStatus: (path: string) => `${path} copié dans le presse-papiers`,
    empty: 'Pas encore de fichiers — ils arrivent dès que le Space peut être construit.',
  },

  signIn: {
    title: 'Se connecter à Hugging Face',
    close: 'Fermer',
    signedInAs: (name: string) => `Connecté en tant que ${name}.`,
    why: 'Utile seulement pour lire un modèle privé ou publier le Space sur ton compte. Le Space, lui, ne demande jamais rien à ses visiteurs.',
    oauth: 'Continuer avec Hugging Face',
    oauthNote: 'Tu quittes la page et tu reviens connecté. La conversation repart de zéro.',
    or: 'ou',
    tokenLabel: 'Jeton d’accès',
    tokenNote:
      'Un jeton à portée fine, créé sur huggingface.co/settings/tokens. Il lui faut l’accès en écriture aux dépôts pour publier un Space ; l’accès en lecture suffit pour consulter un modèle privé. Il reste dans ce navigateur et n’est envoyé qu’au Hub.',
    cancel: 'Annuler',
    useToken: 'Utiliser ce jeton',
  },

  viewport: {
    sizeLabel: 'taille',
    sizeGroup: 'Taille de la zone d’affichage',
    presets: {
      mobile: 'Mobile',
      tablet: 'Tablette',
      // Pas « Portable » : en France un portable est un téléphone, et le bouton d'à côté
      // s'appelle déjà Mobile. « Ordinateur » ne peut pas être lu de travers.
      laptop: 'Ordinateur',
      fill: 'Plein',
    },
    presetOption: (preset: string, width: number, height: number) =>
      `${preset}, ${width} sur ${height} pixels`,
    fillOption: 'Occuper tout le panneau',
    fillHint: 'Aussi large que le panneau',
    rotate: 'Pivoter',
    rotateOption: 'Pivoter la zone d’affichage : la largeur et la hauteur sont échangées',
    zoomLabel: 'zoom',
    zoomGroup: 'Zoom de l’aperçu',
    zoomFit: 'Ajuster',
    zoomFitOption: 'Ajuster le zoom au panneau',
    zoomOption: (zoom: string) => `Zoom à ${zoom}`,
    spokenSize: (width: number, height: number, percent: number) =>
      `${width} sur ${height} pixels, affichés à ${percent} pour cent`,
    gripWidth: 'Fais glisser ou utilise les flèches pour changer la largeur',
    gripHeight: 'Fais glisser ou utilise les flèches pour changer la hauteur',
    gripBoth: 'Fais glisser ou utilise les flèches pour changer la largeur et la hauteur',
    gripWidthHint: 'Faire glisser pour changer la largeur',
    gripHeightHint: 'Faire glisser pour changer la hauteur',
    gripBothHint: 'Faire glisser pour redimensionner',
  },
};
