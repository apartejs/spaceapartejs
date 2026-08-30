/**
 * Le configurateur, en français.
 *
 * Ce fichier est déclaré `ScenarioCopy` — le type dérivé de `en.ts`. Une chaîne qui
 * manque ici est une erreur de compilation, pas un trou dans l’écran de quelqu’un.
 *
 * Ce n’est pas une traduction des MOTS, c’est une traduction de l’intention : le texte
 * doit se lire comme s’il avait été écrit en français. Tutoiement, pas d’anglicisme là
 * où un mot français existe, et la même brièveté que la version anglaise. Quand une
 * phrase anglaise ne passe pas telle quelle, on change la structure plutôt que de la
 * calquer — d’où des paragraphes qui ne se superposent pas ligne à ligne à l’original.
 *
 * Deux choses restent en anglais, exprès, et elles sont reprises de `en.ts` plutôt que
 * réécrites : le tour d’ouverture et la question de la langue. C’est la seule question
 * que tout le monde doit pouvoir lire, quelle que soit la langue devinée par le
 * navigateur — et ses réponses, elles, sont écrites chacune dans sa propre langue.
 */

import type { SpaceConfig } from '../../config/space-config';
import { formatBytes, type ModelScan } from '../../hub/types';
import { LANG_ENDONYM, type Lang, type SpaceLang } from '../../i18n/lang';
import { en, type OnnxSizes, type ScenarioCopy } from './en';

const ouiNon = (value: boolean): string => (value ? 'oui' : 'non');

/** `fichier` / `fichiers`, `taille` / `tailles` — le pluriel simple suffit ici. */
const pluriel = (count: number, nom: string): string => (count === 1 ? nom : `${nom}s`);

/** `q4, fp16 et fp32` — une liste qui se lit, pas un tableau qui se parse. */
function enumere(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** Au féminin : le seul nom que ces nombres comptent ici est « taille ». */
const NOMBRES = ['aucune', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];

const ecrit = (count: number): string => NOMBRES[count] ?? String(count);

/** Ce que chaque jeu de poids ONNX veut dire pour qui attend le téléchargement. */
const PRECISION: Record<string, { label: string; description: string; tradeoff: string }> = {
  q4: {
    label: 'q4 — le plus léger',
    description:
      'Environ le quart du téléchargement complet. L’attente la plus courte, des réponses un peu plus grossières.',
    tradeoff: 'L’attente la plus courte. Des réponses un peu plus grossières qu’avec les poids complets.',
  },
  q4f16: {
    label: 'q4f16 — léger, pour WebGPU',
    description: 'Poids sur 4 bits, calcul sur 16. Aussi petit que q4, et au mieux sur WebGPU.',
    tradeoff: 'Poids sur 4 bits, calcul sur 16 — au mieux sur WebGPU.',
  },
  bnb4: {
    label: 'bnb4 — 4 bits',
    description: 'Un autre encodage sur 4 bits, environ le quart du téléchargement complet.',
    tradeoff: 'Un autre encodage sur 4 bits. Attente courte, réponses un peu plus grossières.',
  },
  int8: {
    label: 'int8 — quantisé',
    description: 'Environ le quart du téléchargement complet, pour une qualité très proche.',
    tradeoff: 'Poids sur 8 bits. Une qualité très proche de celle des poids complets.',
  },
  uint8: {
    label: 'uint8 — quantisé',
    description: 'Environ le quart du téléchargement complet, pour une qualité très proche.',
    tradeoff: 'Poids sur 8 bits. Une qualité très proche de celle des poids complets.',
  },
  q8: {
    label: 'q8 — quantisé',
    description: 'Environ le quart du téléchargement complet, pour une qualité très proche.',
    tradeoff: 'Poids sur 8 bits. Une qualité très proche de celle des poids complets.',
  },
  fp16: {
    label: 'fp16 — demi-précision',
    description: 'La moitié du téléchargement complet, pour une qualité quasi identique.',
    tradeoff: 'Demi-précision. Une qualité quasi identique à celle des poids complets.',
  },
  fp32: {
    label: 'fp32 — précision complète',
    description: 'Les poids complets. Les meilleures réponses, l’attente la plus longue.',
    tradeoff: 'Les poids complets. Les meilleures réponses, l’attente la plus longue.',
  },
};

/** `q4 · 172 MB`, ou `q4` tout court quand le Hub n’a jamais dit ce que ça pèse. */
const pese = (dtype: string, bytes?: number): string => {
  const poids = formatBytes(bytes ?? 0);
  return poids ? `${dtype} · ${poids}` : dtype;
};

/** La langue du Space généré, dite comme on la dirait à voix haute. */
const langueDuSpace = (value: SpaceLang): string =>
  value === 'both' ? 'les deux langues' : LANG_ENDONYM[value];

/** Toute la configuration, une ligne par champ : la réponse à « recap ». */
function recap(config: SpaceConfig): string {
  return [
    `modèle : ${config.modelId || '(aucun pour l’instant — le Space lit MODEL_ID)'}`,
    'exécution : dans le navigateur du visiteur, via transformers.js',
    `poids : ${config.dtype}`,
    `titre : ${config.title || '(aucun pour l’instant)'}`,
    `emoji : ${config.emoji}`,
    `thème : ${config.theme}`,
    `accent : ${config.accent}`,
    `écrit en : ${langueDuSpace(config.lang)}`,
    `pièces jointes : ${ouiNon(config.attachments)}`,
    `prompt système : ${config.systemPrompt ? `${config.systemPrompt.length} caractères` : 'aucun'}`,
    `accueil : ${config.greeting || 'aucun'}`,
    `badge : ${ouiNon(config.badge)}`,
  ].join('\n');
}

export const fr: ScenarioCopy = {
  entry: {
    placeholder: 'Colle un identifiant de modèle, ou dis bonjour',
    emptyState: [
      'Colle un identifiant de modèle — ça ressemble à owner/model — et je construis un Space Hugging Face autour : une seule page, pas de serveur, pas de clés, le modèle qui tourne dans le navigateur de tes visiteurs.',
      '',
      'Tu n’en as pas encore publié ? Dis-le et on continue sans.',
    ].join('\n'),
  },

  script: {
    // Les deux tours d’ouverture restent en anglais : c’est la question que tout le
    // monde doit pouvoir lire, et la deviner d’après le navigateur reviendrait à ne
    // pas la poser. Voir `en.script.language`.
    language: en.script.language,
    languageWithId: en.script.languageWithId,

    languageAgain:
      'Bien sûr. Choisis une langue et je continue dedans — rien de ce que tu as répondu n’est perdu.',

    languageChanged: 'Français à partir d’ici. Dis **go** et on reprend où on en était.',

    welcome: [
      'Voilà ce que je fais. Je construis des Spaces Hugging Face : un modèle en entrée, une vraie page de chat en sortie — une seule page statique, hébergée gratuitement, avec aparté chargé depuis le CDN.',
      '',
      'Le modèle tourne dans le navigateur du visiteur, donc la page ne lui demande rien. Voyons avec quoi je travaille.',
    ].join('\n'),

    welcomeWithId:
      'Parfait — je construis le Space autour de ce modèle. Je le cherche d’abord sur le Hub.',

    scanOnnx: [
      'Ce dépôt fournit des poids ONNX : ce modèle tourne donc dans le navigateur du visiteur. Une seule taille, il n’y a rien à choisir ici — la ligne au-dessus la nomme, et c’est ce fichier que la page générée demandera au Hub.',
      '',
      'Ce que ça veut dire pour qui ouvre ton Space : pas de compte, pas de jeton, rien à payer. Les poids se téléchargent une fois, le navigateur les garde, et toutes les réponses suivantes sont calculées sur sa propre machine.',
    ].join('\n'),

    scanOnnxVariants: [
      'Ce dépôt fournit des poids ONNX : ce modèle tourne dans le navigateur du visiteur, sans compte, sans jeton, sans rien à payer. Les poids se téléchargent une fois et le navigateur les garde.',
      '',
      'Il y en a plusieurs tailles là-dedans, et la taille décide de l’attente à la première visite. Ça vaut une question avant de parler d’apparence.',
    ].join('\n'),

    scanOnnxVision: [
      'Des poids ONNX, en une seule taille — et celui-ci prend les images autant que le texte, alors j’ai activé les pièces jointes dans le composer qu’il générera.',
      '',
      'Tout se passe dans le navigateur du visiteur : pas de compte, pas de jeton, rien à payer. Les poids se téléchargent une fois, et les images qu’il dépose sont lues sur sa propre machine — rien n’est envoyé nulle part.',
    ].join('\n'),

    scanOnnxVisionVariants: [
      'Des poids ONNX — et celui-ci prend les images autant que le texte, alors j’ai activé les pièces jointes. Tout tourne dans le navigateur du visiteur : pas de compte, pas de jeton, rien à payer, et les images qu’il dépose ne quittent jamais sa machine.',
      '',
      'Le dépôt fournit plusieurs tailles de poids, cela dit, et les modèles qui voient sont les plus lourds. Une question avant l’apparence.',
    ].join('\n'),

    scanNoOnnx: [
      'J’ai trouvé le dépôt — il n’y a pas de poids ONNX dedans. C’est le format dont transformers.js a besoin pour faire tourner un modèle dans un onglet, et c’est la seule chose que je ne peux pas improviser.',
      '',
      'Trois pistes, dans l’ordre où je les tenterais :',
      '',
      '- **Cherche sous `onnx-community`.** Cette organisation du Hub publie des copies converties de la plupart des petits modèles connus, souvent en plusieurs tailles. Cherche le nom du modèle là-bas et colle ce que tu trouves.',
      '- **Convertis le tien.** Hugging Face Optimum le fait en une commande — `optimum-cli export onnx --model owner/name onnx/` — puis pousse le dossier `onnx/` dans ton dépôt et je le rescanne.',
      '- **Publie maintenant, vise un modèle plus tard.** La page lit son identifiant de modèle dans la variable `MODEL_ID` du Space : le Space peut partir aujourd’hui et viser le modèle converti le jour où il existe.',
      '',
      'Colle un identifiant converti et je scanne celui-là — ou laisse la case vide et on continue sans modèle.',
    ].join('\n'),

    scanPrivate: [
      'Le Hub a répondu 401 : le dépôt est privé ou sous conditions, je n’ai donc rien pu y lire — ni les poids, ni la tâche, rien.',
      '',
      'À savoir avant le décollage : le navigateur du visiteur va chercher les poids directement sur le Hub, sans jeton dans la page, et un modèle privé le laissera sur ce même 401. On peut continuer et régler le reste à la main.',
    ].join('\n'),

    scanMissing: [
      'Aucun dépôt sous cet identifiant. Ça arrive — les identifiants sont sensibles à la casse, toujours `owner/name`, et on se trompe aussi souvent sur le propriétaire que sur le nom.',
      '',
      'Recolle-le, ou laisse la case vide et on continue sans modèle.',
    ].join('\n'),

    scanError: [
      'Je n’ai pas pu joindre le Hub à l’instant : ça ne dit rien du modèle lui-même, je n’ai simplement pas eu de réponse.',
      '',
      'Rien n’est perdu : on règle le reste à la main, et la détection n’est jamais qu’un raccourci. Dis **go** quand tu veux et je retente la recherche.',
    ].join('\n'),

    scanNone: 'Pas d’identifiant, donc. Rien ici n’en a besoin pour démarrer.',

    modelSet: 'Noté. Je vais le chercher.',

    modelNone:
      'On continue sans. La page générée lit son identifiant de modèle dans la variable `MODEL_ID` du Space : tu peux publier dès aujourd’hui et remplir ça le jour où le modèle est prêt.',

    precisionSet:
      'Noté — le téléchargement est réglé. Chaque visiteur reçoit ces poids une fois, et son navigateur les garde.',

    behaviourDefault: 'Va pour les valeurs par défaut.',

    behaviourCustom: 'Noté. L’apparence, maintenant.',

    behaviourLook: 'L’apparence, donc.',

    appearanceDone: 'C’est noté. J’écris les fichiers.',

    filesReady: [
      'Ton Space est généré — les fichiers sont listés au-dessus, et l’aperçu à droite, ce sont exactement ces octets-là.',
      '',
      'Pas d’étape de build, pas de bundler, pas de serveur : `index.html` charge aparté et transformers.js depuis un CDN et fait le reste dans l’onglet.',
    ].join('\n'),

    filesReadyNoModel: [
      'Généré — l’aperçu à droite est la vraie page, et elle restera une page sans modèle tant que tu ne lui en donnes pas un.',
      '',
      'C’est une voie prévue : `index.html` lit `MODEL_ID` dans les variables du Space, et ne retombe sur la valeur inscrite qu’à défaut. Publie-la maintenant, ajoute la variable quand le modèle existe, et le visiteur suivant a un chat qui marche.',
    ].join('\n'),

    filesReadyPrivate: [
      'Généré — l’aperçu à droite est la vraie page.',
      '',
      'Une chose à corriger d’abord : les poids sont récupérés sur le Hub par le navigateur du visiteur, et ce modèle est privé. Il tomberait sur un 401 et le chat ne démarrerait jamais. Rends le modèle public, ou colle un identifiant public et je reconstruis autour.',
    ].join('\n'),

    filesIncompleteModel:
      'Presque. Je ne peux pas écrire les fichiers sans identifiant de modèle — c’est le seul champ qui n’a pas de valeur par défaut raisonnable.',

    filesError:
      'Le générateur a refusé cette configuration — la ligne au-dessus dit pourquoi. Dis **recap** et je réessaie.',

    outcomeDownload: 'Je fais le zip.',

    outcomePush: 'Bien — go/no-go. Rien n’est écrit sur ton compte tant que tu n’as pas dit oui.',

    outcomePushAnon:
      'Il me faut ton compte Hugging Face pour ça, et je n’en vois pas. Connecte-toi, puis dis **go** — ou prends le zip à la place.',

    downloaded: [
      'Enregistré. Deux fichiers : `index.html`, qui est toute l’application, et un `README.md` dont l’en-tête dit à Hugging Face que ce Space est **statique**.',
      '',
      'Pour le mettre en orbite : nouveau Space sur Hugging Face, SDK **Static**, puis dépose ces fichiers à la racine du dépôt. N’importe quel hébergeur statique fait tout aussi bien — il n’y a pas de backend à faire tourner.',
    ].join('\n'),

    downloadedNoModel: [
      'Enregistré. Nouveau Space sur Hugging Face, SDK **Static**, dépose ces fichiers à la racine — ou sers-les depuis n’importe quel hébergeur statique. Il n’y a pas de backend à faire tourner.',
      '',
      'Puis la seule chose qui reste : dans **Settings → Variables** du Space, ajoute `MODEL_ID` avec ton `owner/model`. La page le lit au chargement, il n’y a rien à reconstruire.',
    ].join('\n'),

    downloadError:
      'Le zip n’est pas passé — la ligne au-dessus porte l’erreur. Dis **zip** pour réessayer.',

    pushed: [
      'Décollage. Le Space est en ligne — l’URL dans la ligne au-dessus l’ouvre.',
      '',
      'C’est une page statique : elle est debout dès que les fichiers arrivent. Ouvre-la et envoie-lui un message — le premier télécharge les poids, tous les suivants sont instantanés.',
    ].join('\n'),

    pushedNoModel: [
      'Décollage. Le Space est en ligne — l’URL dans la ligne au-dessus l’ouvre — et il n’a pas encore de modèle.',
      '',
      'Une chose à faire ensuite : sur le Space, **Settings → Variables**, ajoute `MODEL_ID` avec ton `owner/model`. La page le lit au chargement, un rafraîchissement suffit.',
    ].join('\n'),

    pushError:
      'La publication a échoué — la ligne au-dessus dit ce que le Hub a répondu. Dis **go** pour réessayer, ou **zip** pour prendre les fichiers.',

    pushRejected:
      'Pas de publication, donc — rien n’a quitté ton navigateur. Le zip reste sur la table : dis **zip** quand tu veux.',

    paused: 'En pause — pas de réponse, pas de dégât. Dis **go** et je repose la question.',

    help: [
      'Voilà comment ça marche.',
      '',
      '- Les boutons dans la boîte en dessous sont le chemin rapide : un clic vaut réponse.',
      '- Tu peux écrire à la place. Demande-moi **onnx**, la **taille**, le **coût**, les **téléphones**, les modèles **privés**, ou **aparté** lui-même.',
      '- Colle un identifiant de modèle quand tu veux et je scanne celui-là.',
      '- Dis **recap** pour la configuration actuelle, **zip** pour récupérer les fichiers tels quels, **langue** pour en changer, ou **recommencer** pour repartir de zéro.',
      '',
      'Dis **go** pour reprendre où on en était.',
    ].join('\n'),

    onnx: [
      'ONNX est le format dont transformers.js a besoin pour faire tourner un modèle dans un onglet, sur WebGPU ou WASM, sans serveur nulle part. Un dépôt l’a quand il porte un dossier `onnx/` de poids, souvent en plusieurs tailles.',
      '',
      'La plupart ne l’ont pas, et il y a deux façons de contourner ça. `onnx-community`, sur le Hub, publie des copies converties de la plupart des petits modèles connus. Sinon, convertis le tien avec Hugging Face Optimum — `optimum-cli export onnx --model owner/name onnx/` — et pousse le dossier `onnx/` dans le dépôt.',
      '',
      'Colle un identifiant converti dès que tu en as un, ou dis **go** pour continuer.',
    ].join('\n'),

    size: [
      'Les poids se téléchargent une fois, au premier message du visiteur, et le navigateur les garde ensuite. Toutes les visites suivantes démarrent instantanément.',
      '',
      'Combien : un petit modèle d’embeddings pèse quelques dizaines de mégaoctets, un modèle de chat de 0,5 milliard de paramètres en 4 bits tourne autour de 300 MB, et un 7 milliards dépasse le gigaoctet — ce qui fait beaucoup à demander pour une première visite. Des poids quantisés pèsent environ le quart des poids complets et répondent un peu plus grossièrement ; la demi-précision, c’est la moitié des octets pour une qualité presque indistinguable.',
      '',
      'Dis **go** pour continuer.',
    ].join('\n'),

    cost: [
      'Rien, des deux côtés. Un Space statique est gratuit à héberger sur Hugging Face — il n’y a pas de machine à louer, puisque rien ne tourne sur un serveur. Les poids viennent du CDN du Hub, gratuit lui aussi, et aparté comme transformers.js d’un CDN public.',
      '',
      'Tes visiteurs ne paient rien et ne signent rien : pas de compte, pas de jeton, pas de clé dans la page. Le seul coût, où que ce soit, c’est leur bande passante, une fois, pour le téléchargement.',
      '',
      'Dis **go** pour continuer.',
    ].join('\n'),

    phone: [
      'Oui, dans la limite du raisonnable. transformers.js utilise WebGPU là où le navigateur le propose et retombe sur WASM sinon : un téléphone récent fera tourner un petit modèle — plus lentement qu’un ordinateur, et plus chaud.',
      '',
      'Les limites sont la mémoire et la patience : quelques centaines de mégaoctets de poids passent bien sur un téléphone moderne, plusieurs gigaoctets non. Si les téléphones comptent pour toi, prends les poids les plus légers proposés et reste sous le milliard de paramètres.',
      '',
      'Dis **go** pour continuer.',
    ].join('\n'),

    aparte: [
      'aparté est la bibliothèque de chat dont cette page est faite, et celle que ton Space chargera. Des web components — un chat, un composer, des appels d’outils, et le panneau de questions sur lequel tu cliques depuis tout à l’heure — sans framework et sans étape de build : une balise script et un provider.',
      '',
      'C’est pour ça que ce configurateur vaut la peine d’être montré. Rien ici n’est une maquette de chat : le script est un provider, chaque étape est un vrai appel d’outil, et chaque question une vraie élicitation. Ton Space généré, c’est la même bibliothèque, qui parle à transformers.js dans le même onglet.',
      '',
      'Dis **go** pour continuer.',
    ].join('\n'),

    private: [
      'La page générée ne porte aucun jeton : le navigateur du visiteur demande les poids au Hub de façon anonyme. Un dépôt privé ou sous conditions répond 401, et le chat ne démarre jamais.',
      '',
      'Deux issues — rendre le modèle public, ou viser un modèle public. Te connecter ici me laisse seulement lire le dépôt pendant qu’on construit ; ça ne suit pas tes visiteurs.',
      '',
      'Dis **go** pour continuer.',
    ].join('\n'),

    recap: 'Voici tout ce que j’ai pour l’instant.',

    restart: [
      'On peut repartir de n’importe quel identifiant de modèle : colle-en un et je reconstruis tout autour. Rien ne survit que tu ne m’aies dit — et si tu veux une vraie page blanche, recharger celle-ci t’en donne une.',
      '',
      'Alors : quel modèle ?',
    ].join('\n'),

    zip: 'Je zippe ce que j’ai.',
  },

  ask: {
    // La seule question posée en anglais, quoi qu’il arrive : ses réponses, elles,
    // sont écrites chacune dans sa propre langue. Voir `en.ask.language`.
    language: en.ask.language,

    model: {
      message: {
        none: 'Quel est l’identifiant du modèle ? Ça ressemble à owner/model — laisse vide si tu n’en as pas encore publié.',
        converted:
          'Quel identifiant je scanne ? Une copie `onnx-community/…`, ou ton propre dépôt une fois le dossier `onnx/` dedans. Laisse vide et on continue sans modèle.',
        missing:
          'Quel est l’identifiant, alors ? Sensible à la casse, toujours owner/name. Laisse vide et on continue sans modèle.',
        restart: 'Autour de quel modèle on construit, cette fois ?',
      },
      placeholder: 'owner/model',
    },

    precision: {
      message: (variants: readonly string[], sizes: OnnxSizes = {}): string =>
        `Ce dépôt fournit ${ecrit(variants.length)} ${pluriel(variants.length, 'taille')} de poids : ${enumere(variants.map((dtype) => pese(dtype, sizes[dtype])))}. Celle que tu choisis, c’est ce que chaque visiteur télécharge une fois, avant sa première réponse — plus petit démarre plus tôt, plus gros répond un peu mieux.`,
      option: (dtype: string, bytes?: number): { label: string; description: string } => {
        const connu = PRECISION[dtype];
        const poids = formatBytes(bytes ?? 0);
        if (!connu) {
          return { label: pese(dtype, bytes), description: 'Un autre jeu de poids présent dans le dépôt.' };
        }
        return poids
          ? { label: `${dtype} · ${poids}`, description: connu.tradeoff }
          : { label: connu.label, description: connu.description };
      },
    },

    behaviour: {
      message: 'Quelque chose à changer avant que je construise ?',
      defaults: {
        label: 'Construis avec les valeurs par défaut',
        description: (config: SpaceConfig): string =>
          `Un assistant polyvalent appelé « ${config.title || 'Aparté chat'} », sans prompt système — c’est le visiteur qui parle en premier.`,
      },
      custom: {
        label: 'Écrire un prompt système et un accueil',
        description: 'Ce que l’assistant sait de lui-même, et la phrase qui accueille un visiteur.',
      },
      look: {
        label: 'Changer l’apparence',
        description: 'Titre, emoji, thème, couleur d’accent et langue, un à la fois.',
      },
      systemPrompt: {
        header: 'Prompt système',
        title: 'Que faut-il dire à l’assistant sur lui-même ?',
        description: 'Envoyé avant chaque conversation, et le visiteur ne le voit jamais.',
        placeholder: 'Tu es un assistant utile pour…',
      },
      greeting: {
        header: 'Accueil',
        title: 'Première phrase que lit le visiteur, avant d’écrire quoi que ce soit.',
        description: 'Écrite dans la page, pas générée — elle ne coûte aucun téléchargement.',
        placeholder: 'Pose-moi une question sur…',
      },
    },

    appearance: {
      message: 'À quoi ça doit ressembler ?',
      form: 'Cinq choses, une à la fois. Les pastilles te ramènent à n’importe laquelle.',
      keep: {
        label: 'Garder ça',
        description: (config: SpaceConfig): string =>
          `${config.emoji || '🛸'} ${config.title || 'Aparté chat'} · thème ${config.theme} · accent ${config.accent} · ${langueDuSpace(config.lang)}`,
      },
      custom: {
        label: 'Je les règle',
        description: 'Titre, emoji, thème, couleur d’accent et langue de la page.',
      },
      title: {
        header: 'Titre',
        title: 'Comment s’appelle le Space ?',
        description: 'Ça s’affiche sur la carte du Space, et dans l’en-tête de la page elle-même.',
      },
      emoji: {
        header: 'Emoji',
        title: 'Un emoji pour la carte du Space.',
        description: 'Hugging Face l’affiche à côté du titre partout où le Space est listé.',
      },
      theme: {
        header: 'Thème',
        title: 'Dans quel thème le Space s’ouvre-t-il ?',
        light: 'Clair',
        lightNote: 'Clair pour tout le monde, quelles que soient les préférences de la machine.',
        dark: 'Sombre',
        darkNote: 'Sombre pour tout le monde, quelles que soient les préférences de la machine.',
        system: 'Suivre le système du visiteur',
        systemNote: 'Celui qu’il a déjà choisi. La réponse sûre.',
      },
      accent: {
        header: 'Accent',
        title: 'Couleur d’accent, en hexadécimal.',
        description:
          'Les boutons, les liens, la flèche d’envoi, l’anneau de focus. Tout le reste suit.',
        placeholder: '#FF3E00',
      },
      spaceLang: {
        header: 'Langue',
        title: 'Dans quelle langue le Space est-il écrit ?',
        description:
          'Les mots de la page — l’accueil, le bouton d’envoi, le texte d’invite. Pas la langue des réponses du modèle : celle-là suit ce que le visiteur écrit.',
        both: 'Les deux',
        bothNote: 'La page embarque les deux et suit le navigateur de chaque visiteur.',
        englishNote: 'L’anglais pour tous les visiteurs, où qu’ils l’ouvrent.',
        frenchNote: 'Le français pour tous les visiteurs, où qu’ils l’ouvrent.',
      },
    },

    outcome: {
      message: (config: SpaceConfig): string =>
        `${config.emoji || '🛸'} « ${config.title || 'Aparté chat'} » est construit. Et maintenant ?`,
      download: {
        label: 'Télécharger le zip',
        description:
          'Les fichiers, sur ta machine. À dézipper dans un Space statique, ou à héberger n’importe où.',
      },
      push: {
        label: 'Créer le Space sur mon compte',
        descriptionSignedIn: (user: string, name: string): string =>
          `Un nouveau Space statique public à ${user}/${name}. Je demande avant d’écrire quoi que ce soit.`,
        descriptionAnonymous: 'Il faudra d’abord te connecter à Hugging Face.',
      },
      name: {
        message: 'Comment s’appelle le Space sur le Hub ? En minuscules, sans espaces.',
        placeholder: 'mon-modele-chat',
      },
    },

    signIn: {
      message:
        'Ce dépôt est privé ou sous conditions. Je peux te connecter à Hugging Face et réessayer, ou on continue à la main.',
      yes: { label: 'Me connecter et réessayer', description: 'Accès en lecture à tes propres dépôts.' },
      no: {
        label: 'Continuer à la main',
        description: 'Rien n’est bloqué — la détection n’est qu’un raccourci.',
      },
    },
  },

  result: {
    languageSet: (code: Lang): string => `Langue : ${LANG_ENDONYM[code]}.`,

    scanNone: 'Aucun identifiant de modèle à scanner.',
    scanFound: (scan: ModelScan, variants: string[]): string =>
      [
        `${scan.id} — trouvé.`,
        `tâche : ${scan.pipelineTag ?? 'non déclarée'} · bibliothèque : ${scan.libraryName ?? 'non déclarée'}`,
        variants.length > 0
          ? `poids ONNX : ${scan.onnxFiles.length} ${pluriel(scan.onnxFiles.length, 'fichier')}, ${ecrit(variants.length)} ${pluriel(variants.length, 'taille')} (${variants
              .map((dtype) => pese(dtype, scan.onnxSizes?.[dtype]))
              .join(', ')})`
          : 'poids ONNX : aucun dans ce dépôt',
        `entrée image : ${ouiNon(scan.supportsImage)}`,
        `visibilité : ${scan.isPrivate ? 'privé' : scan.gated ? 'sous conditions' : 'public'}`,
      ].join('\n'),
    scanPrivate: (id: string): string =>
      `${id} — 401. Privé ou sous conditions : rien n’a pu être lu.`,
    scanMissing: (id: string): string => `${id} — 404. Aucun dépôt sous cet identifiant.`,
    scanError: (id: string, error: string | null): string =>
      `${id} — le Hub n’a pas pu être joint${error ? ` : ${error}` : '.'}`,
    signedIn: (user: string): string => `Connecté en tant que ${user}. Nouveau scan.`,
    signInFailed: 'La connexion n’a pas abouti. On continue à la main.',

    modelSet: (id: string): string => `Identifiant du modèle : ${id}.`,
    modelNone:
      'Aucun identifiant de modèle. La page générée lira MODEL_ID dans les variables du Space.',
    modelInvalid: (typed: string): string =>
      `« ${typed} » n’est pas un identifiant owner/name : le modèle reste vide.`,

    precisionSet: (dtype: string, bytes?: number): string => `Poids : ${pese(dtype, bytes)}.`,
    precisionKept: (dtype: string, bytes?: number): string =>
      `Un seul jeu de poids dans le dépôt : ${pese(dtype, bytes)}.`,

    behaviourDefault: 'Comportement et apparence par défaut.',
    behaviourCustom: (config: SpaceConfig): string =>
      [
        `prompt système : ${config.systemPrompt ? `${config.systemPrompt.length} caractères` : 'aucun'}`,
        `accueil : ${config.greeting || 'aucun'}`,
      ].join('\n'),
    behaviourLook: 'Directement à l’apparence.',

    appearanceKept: (config: SpaceConfig): string =>
      `${config.emoji} ${config.title} · thème ${config.theme} · accent ${config.accent} · écrit en ${langueDuSpace(config.lang)}`,

    generated: (paths: string[]): string =>
      `${paths.length} ${pluriel(paths.length, 'fichier')} : ${paths.join(', ')}`,
    generatedIncomplete: (missing: string[], config: SpaceConfig): string =>
      [`Il manque encore : ${missing.join(', ')}.`, '', recap(config)].join('\n'),
    generateFailed: (error: string): string => `La génération a échoué : ${error}`,

    recap,

    outcomeDownload: 'Téléchargement du zip.',
    outcomePush: (user: string, name: string): string => `Prêt à créer ${user}/${name}.`,
    outcomePushAnonymous: 'Aucun compte en vue — connecte-toi d’abord.',
    outcomeNone: 'Aucun choix fait.',

    zipSaved: (filename: string | undefined): string =>
      filename ? `${filename} enregistré.` : 'Le zip a été remis à ton navigateur.',
    zipFailed: (error: string): string => `Le zip a échoué : ${error}`,

    pushed: (url: string): string => `En ligne : ${url}`,
    pushFailed: (error: string): string => `Le Hub a refusé la publication : ${error}`,

    noAnswer: 'Pas de réponse — la question a été écartée.',
  },

  tools: {
    ask_language: 'Demander dans quelle langue le configurateur doit parler.',
    scan_model: 'Chercher un modèle sur le Hub Hugging Face et pré-remplir ce qu’il permet.',
    ask_model: 'Demander un identifiant de modèle Hugging Face.',
    ask_precision: 'Demander quel jeu de poids ONNX le visiteur téléchargera.',
    ask_behaviour:
      'Demander s’il faut garder les valeurs par défaut, ou régler le prompt système et l’accueil.',
    ask_appearance: 'Demander le titre, l’emoji, le thème, la couleur d’accent et la langue du Space.',
    generate_files:
      'Générer les fichiers du Space à partir de la configuration et rafraîchir l’aperçu.',
    ask_outcome: 'Demander s’il faut télécharger le zip ou créer le Space sur le Hub.',
    download_zip: 'Empaqueter les fichiers générés en zip et le remettre au navigateur.',
    create_space: 'Créer le Space sur le compte Hugging Face de l’utilisateur et y pousser les fichiers.',
  },

  /**
   * Les lignes d’outils.
   *
   * Ce qui vient du Hub — un identifiant, un tag de pipeline, une erreur renvoyée par le
   * Hub — reste tel quel : ce sont ses mots, pas les nôtres. `onnx` non plus ne se
   * traduit pas, c’est un nom de format.
   */
  rows: {
    state: {
      running: 'En cours',
      waiting: 'En attente',
      declined: 'Refusé',
      stopped: 'Arrêté',
      failed: 'Échec',
      nothingToScan: 'Rien à chercher',
      scanned: 'Trouvé',
      locked: 'Verrouillé',
      noRepo: 'Aucun dépôt',
      unreachable: 'Injoignable',
      incomplete: 'Incomplet',
      written: 'Écrit',
      refused: 'Refusé',
      live: 'En ligne',
      saved: 'Enregistré',
      unanswered: 'Sans réponse',
      answered: 'Répondu',
    },

    stage: {
      approval: 'j’attends ton feu vert',
      declined: 'tu as refusé cet appel',
      stopped: 'arrêté avant la fin',
      crashed: 'le gestionnaire a planté',
    },

    scan: {
      readingHub: 'lecture du Hub…',
      reading: (id: string): string => `lecture de ${id} sur le Hub…`,
      noModelYet: 'pas encore d’identifiant',
      shipsOnnx: 'des poids ONNX sont publiés',
      noOnnx: 'pas de poids ONNX',
      vision: 'vision',
      task: 'tâche',
      library: 'bibliothèque',
      onnx: 'onnx',
      imageInput: 'entrée image',
      visibility: 'visibilité',
      notDeclared: 'non déclarée',
      noneInRepo: 'aucun dans ce dépôt',
      files: (count: number, dtypes: string[]): string =>
        `${count} fichier${count === 1 ? '' : 's'}${dtypes.length > 0 ? ` — ${dtypes.join(', ')}` : ''}`,
      yes: 'oui',
      no: 'non',
      private: 'privé',
      gated: 'sous conditions',
      public: 'public',
      locked: '401 — privé ou sous conditions, rien n’a pu être lu',
      notFound: '404 — aucun dépôt sous cet identifiant',
      unreachable: 'le Hub n’a pas pu être joint',
    },

    files: {
      writing: 'écriture des fichiers…',
      refused: 'le générateur a refusé cette configuration',
      stillMissing: (missing: string[]): string => `il manque encore : ${missing.join(', ')}`,
      configIncomplete: 'configuration incomplète',
      nothingWritten: 'rien n’a été écrit',
      counted: (count: number): string => `${count} fichier${count === 1 ? '' : 's'}`,
      total: 'total',
    },

    space: {
      creating: 'création du Space sur le Hub…',
      approval: 'j’attends ton feu vert — ceci écrit sur ton compte',
      refused: 'le Hub a refusé la publication',
      theSpace: 'le Space',
      noModel: 'pas encore d’identifiant — renseigne MODEL_ID dans le Space',
    },

    zip: {
      zipping: 'compression des fichiers…',
      failed: 'le zip n’est pas passé',
      handed: 'remis à ton navigateur',
      noModel: 'pas encore d’identifiant — renseigne MODEL_ID avant de déployer',
    },

    ask: {
      waiting: 'j’attends ta réponse…',
      noAnswer: 'pas de réponse',
      model: 'Modèle',
      precision: 'Poids',
      behaviour: 'Comportement',
      appearance: 'Allure',
      outcome: 'Suite',
      behaviourDefault: 'valeurs par défaut gardées',
      behaviourCustom: 'prompt et accueil sur mesure',
      behaviourLook: 'directement à l’allure',
      appearanceDefault: 'gardée telle quelle',
      appearanceCustom: 'réglée à la main',
      outcomeDownload: 'télécharger le zip',
      outcomePush: 'créer le Space',
      outcomeAnonymous: 'aucun compte à portée',
    },
  },
};
