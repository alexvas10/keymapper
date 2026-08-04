// ---------------------------------------------------------------------------
// English corpus
//
// Serves two purposes, both mirroring keybr: it is the dictionary lessons draw
// their words from, and it is the training data for the character-level
// phonetic model that fills in when an alphabet can spell too few real words.
//
// Four thousand common English words in frequency order — the order matters,
// because a lesson prefers the commonest words the layout can spell. Counted
// from fourteen public-domain novels on Project Gutenberg (Austen, Dickens,
// Doyle, Melville, Shelley, Stevenson, Stoker, Twain, Wilde and others), then
// restricted to dictionary words of 2-9 letters. Prose rather than web text is
// deliberate: it is what makes the lists read like language, and it is the same
// choice keybr makes. Proper nouns are dropped by discarding words usually
// capitalised mid-sentence, so the novels' characters do not become vocabulary.
// ---------------------------------------------------------------------------

export const WORDS: string[] = `
the and to of in that he it was his you with had as for not her but at is him on she be my all
me have so said by this from they were there what one which we no when would if been out up or
an them could now who are then do very their more will your man some into did time about like
only know see well how down before any little can come over must again such than good am after
old has much other never go upon should say here two us went himself our way made think long day
thought came own first its don where away back too eyes may might hand being these nothing still
face room every head looked just though off great seemed without life look last got most night
men even shall ever yet saw those same through another tell right why something get always dear
took let take make thing yes house while began done left quite heard young once going round felt
soon asked oh door father place found moment people told put three looking many because under
seen whole myself mind having give knew hands side things herself love better turned says want
half both friend morning cried voice poor far whom anything home till heart sir words sat stood
enough few between white world gone against new word along find part however hear does gave
general almost among behind set sure next work mother indeed boy hope each light coming cannot
lay woman suddenly nor really sea called passed ship end kind name air wish together since fire
brought whether speak already taken lady rather days perhaps believe others around letter course
wife table dead replied matter death open also body leave years water often army near small talk
alone best keep sister towards times help evening business full feel smile ask rest happy
feeling present saying dark sort case returned else bed black strange manner answered sometimes
wanted true read answer family high less whose window ready fellow town hour kept known ran
given question arm spoke pretty large four son least boat lost child money yourself feet mean
taking added within call order either five tried used stopped possible afraid won became idea
certain short close hair red sound reason held soul power fell countess front turn entered point
pleasure during fear cold sleep officer husband doubt sitting sight itself bad until gentleman
hard evidently certainly hardly seeing country making across opened state continued remember
rose sent several friends struck forward horse road girl standing low brother daughter women
arms line received glad talking dinner horses strong appeared followed run subject doing past
thousand suppose ground longer hold eye happened moved above use late second live turning met
soldiers seem book person therefore blood ten battle able fine try different lips remained
position laid attention change silence sun minutes seems return terrible thinking twenty silent
wished feelings thus walked hundred children drawing fact means free ill account clear happiness
show usual none care year river lorry warn deep ought tears nature thoughts speaking stand
corner mine everybody chief cause company war enemy sense trying ago news pocket hours self
getting cut besides mouth clock beyond chair drew crowd comes interest repeated opinion please
chance carriage village become blue bring wonder master need stay beside trouble tone bear
beautiful wait toward heavy neither quiet truth wind foot waiting carried walk write necessary
watch real commander pass officers faces human story shouted party merely living except instant
action deal reached meet talked showed married society straight noticed six started expected
grew sorry secret cry minute coat fixed easy knows nobody common pale beginning running steps
led giving raised early natural paper thank meant wild gentlemen quick play orders danger shook
whatever earth later history strength visit view distance glass ladies deck broken loved closed
object quickly die character dress third whales leg listened troops further wrong sit duty law
smoke boys purpose hill box form wall fancy holding perfectly figure wounded joy rode surprise
land big fresh smiling service sake stop reply hat knowledge bright nearly wine wood lived
smiled former spirits beauty dare lying notice laughed killed regiment top placed pleasant looks
letters floor caught forget arrived prisoner dropped wrote anyone everyone heads begun pleased
pain changed shoulder movement marriage glanced single bit asleep breakfast marry slowly
dreadful died force middle important effect meaning creature handsome court worse dog knowing
week peace length instead leaving passing plain fall begin exactly fish step send thin anybody
satisfied below settled act presence reckon church sides pity fast morrow ball sudden piece
walking engaged presently direction clothes probably study written consider sweet save moving
broke entirely age fair spirit trees threw shot observed command likely soldier questions spoken
worth seven green neck iron makes angry voices meeting places gold expressed tea garden curious
legs laugh shoulders various fingers hot yesterday number imagine stranger outside post months
plan note wonderful allowed drawn listen safe remain greater miles putting comfort wide
exclaimed sign cap passage shut touch pray remarked following art reading follow laughing
believed devil hearing calm events spent mad finished darkness sad whispered supper filled
simply sky spot aye start touched serious occurred eat surprised dressed telling desire teeth
regard horror cross island scarcely rooms covered affection move terror bound mere field journey
kissed occasion eight snow crew companion affairs fortune latter formed twice ordered anxious
stone board honor decided mentioned promise papers camp pipe lad seat gate picture awful rising
bent streets goes kill respect broad greatest girls ourselves pay asking ears breath rushed
quietly nose appear lie glance health boats nearer allow obliged tall mighty influence waited
spite quarter curiosity grown drove hurry lives thrown weather evil contrary future lower seized
breast ways occupied growing pointed scene degree drink mile hung hall liked forehead easily
rich fallen grave difficult farther someone bridge situation houses moments event happen escape
shore instantly forth resolved convinced prepared honour city simple lines supposed directly
enter noble youth alive pride stern sharp weeks watched sick expect somebody windows trust
prisoners dream crossed excellent miserable aside charming unknown equal lose matters pause
memory lead public delight music watching effort forgotten paused complete woods condition
adjutant lit rate blow break fight learned yard spring coach cabin sail warm knife boots blame
otherwise unable according freedom listening sounds yours attack paid agreeable assure nine
rapidly manners carry mark key presented books thick summer finally tired keeping afternoon
handed vain fifty thirty pressed hoped horrible fool spread joined throat tree drive gentle
property pointing empty burst opposite lifted express glancing candle generally fond tail
beneath finger affair although explain brain result maybe bottom school peculiar mention rain
fate office somewhere nonsense promised proper writing seated wore path ashamed couple proud
forty higher conscious hanging stairs soft ones loud worn shown whenever cook knees arrival
hurried nice speech mate mast report forgive suffering staff dull beat dance pulled guard
excited guns loss grow learn cheerful perfect raft burning prison shop slight weak extremely
unless join bow shadow private opening somehow calling despair clearly leaning wishes chest
ships mist lamp kindness relations falling whisper addressed courage clean yellow charge
superior coffin circle advantage fit stepped dying shouting blind voyage peasants leaves feared
shaking wake touching servants evident military possibly offer noise ceased servant dressing
catch dogs passion regular advance main lies excuse success whaling dry avoid harm throw temper
ear colour bare due draw personal absence kindly worst slow dust lot hopes vast activity sofa
finding ring carefully rope offered doors locked bottle reach fetch muttered bread played gun
game loose dancing destroyed match visible habit cousin period proved busy rise wants sorrow
somewhat forced winter wretched worked surely ease luck special gin gazed hole hurt jumped
clever rolled group misery lovely caused steady tomorrow yards treasure seek intended food
suffered laws drop returning solemn delighted distant month dangerous slept beg produced grass
removed bag prove bell receive fully cruncher actually honest widow stick gradually intention
highly address sought conduct moon directed agreed monster aim silently pushed previous plainly
bowed born mass advice taste playing softly carrying bore younger wound maid regarded apart
anxiety spare bye attempt sisters advanced thinks cannon mistake inside murder hid familiar
ahead saved midnight cat existence unhappy precious grief storm train campaign fault ideas rya
dat pieces remark gazing strike nights stronger pull gives aware police deeply edge highest
kitchen flew hearts nodded kiss relief cheeks justice firm working sympathy amiable wishing
flank wet drunk baby eager laughter tied squire increased assured similar waters guess dared
sleeping seas twelve tongue terms names turns retreat needed pursued leaned ashore ocean cast
naturally goodness entering showing sooner crying hide alarm singing fly tide greatly cases
plans ice favour dearest forces grey bringing sigh double search sank walls uniform direct
necessity angrily reasons delay explained huge slightly facts dread hussars generals odd takes
anywhere mistaken breathing shirt clouds amongst estate attached visitor expecting hastily
confusion fashion patient laying rough suspicion signs porch possessed marked shoes pair
creatures confused today ride innocent equally firing waves wooden trembling arranged fellows
mystery witness judged bless heavily merry powers receiving space wolf task admit charm science
brave birds helped leading share raise shed genius splendid oil galloped golden narrow raising
prevent gained rum observe gratitude friendly victory visitors dim evidence station anger
thunder sprang smell value gathered midst desired grateful judgment parted sacrifice cards hers
persons flying setting retired striking log forest tender brilliant fifteen usually pardon
useful hurriedly suit upstairs guests shock bar riding vessel glory confess crime refuse false
portrait actions amid worthy parts breaking virtue earnest animated informed recalled peasant
forgot eagerly cart immense song meanwhile hollow weight cruel weary delicate strongly suffer
wedding lightning capital concluded faint hunt chosen hidden skin regret details carts shame
destroy lighted remains depend agitation shining gently finish stretched attended murmured
aboard thanks imagined careful reckoned chase flushed connected dining painful battery shadows
lock flowers seldom sing bitter gay belief burned separate credit dozen lights sensible spend
examined concerned utmost aloud recovered buried fog safety motion truly crossing driving
brothers plenty roof wise bird bones succeeded throwing described fears cloak upper thousands
rank lively serve entire dignity stupid slipped sighed lest shake uttered headed driven gloomy
proceeded gown club dey lately nervous queer shape uneasy behaviour troubled style despite
accept wholly nephew stir nurse rush jaw hint flung rock ancient loving abandoned wanting
blessed surface required parties wearing absent awake marrying race savage animal brown hate
foolish stout faith useless swear agitated stars abroad quarters fail struggle intimate ranks
happens welcome declared height instance drinking settle appears distress pistol bench mud bosom
views discovery relation chiefly roads hussar ignorant cool violent missed seriously fourth knee
cleared dreams stayed dragged departure rolling nearest points cloud choose daylight ordinary
powerful aspect lip speed begged trial enormous inquired bearing served current example features
prayer aid hain inquiry proof infantry crowded pressing picked figures noticing favourite heat
stared flight extreme suggested capable stream failed rapid coffee daughters shin sand authority
treated entrance moral choice weakness moonlight dawn attend add strangely sovereign letting
anyway liberty final gloom appointed coarse stopping pulling smoking staring invited reality
ruin pursuit notes dollars illness elder assumed coachman demanded hut size chin dirty mortal
gracious eyebrows sum famous stage describe cave fortunate persuaded candles suite serfs
wondered fur tells closer agree cheek consent lantern aloft arose lads painted job obvious nigh
attitude mercy affected chap causes exercise fortnight secure mountains solitary gesture cavalry
desperate sorts hungry modern becoming cries resumed noon willing belonged triumph swept sails
perceived disturbed concern starting torn escaped progress tear formerly endure sergeant sword
wondering alas sounded refused loudly readily language shone dine building minds thrust approach
acted reception emotion boxes darling harpoon canoe cutting rule remaining balls meantime rid
rage admitted souls landlord faced claim praise proposed fields firmly lift bet courtyard mood
onto pictures managed frame haven closely eating shade partner thanked drank beheld guilty
arrive carriages jacket intervals sheet tossed stuck separated accepted humanity employed
reflected bedroom straw tale notion elbow folded knocked agony bone native armed port bows marks
request enjoyment utter wear brow reproach vanity suspected niece driver chain row taught
frowning series beating fighting pace grace ruined deserted rang fatal damp efforts danced feels
household whalemen pounds hit tight fairly beloved forms exhausted pick fro craft shortly built
interests movements fearful related profound theory knitting rubles pap ours sailed buy funeral
conceal sailors fever awoke awkward disposed badly scheme material flesh continue energy devoted
revealed band sunset ivory mon centre proceed jury lonely footsteps hunting trembled remarks
content kings vague quit senses track level ended hammer cottage rendered clerk visited chamber
sacred hideous fancied fat crept happening warning council pockets tore mounted class joke
smooth oars hiding sunk sin floating deed bout happily inquiries occur guardian deeper staircase
citizen captured bin larger coast patience vanished needs repeating fix stones bold unusual sold
mild persuade fence seeking united severe singular reminded amused forge scared lasted constant
hundreds coloured likewise deadly absolute infinite gain stock ends stirred wealth delicacy
original division compared stands parents insisted belong reaching woke sink monstrous staying
eternal supposing jump precisely horrid roll fought sailing spout partly prospect reward
answering preparing season heavens squadron fishery sadly mixed stuff footman enjoy natured fun
mostly dig glasses loaded swift comrades bought forever smiles cover distinct fired scattered
valet gets unnatural assurance extent education moreover borne blushed joyful lover rested
yonder darted flame offended immediate gravely sensation altered losing blows alarmed collected
hang message revenge slip strain missing commanded humour pains habits domestic duties closing
committed wrapped official major ate older solemnly cunning contempt works cup powder wicked
daily sees ghost mates advancing pure alike hence hero lofty bending trap objects subtle eldest
prepare wheels madness stole burn measure wherever sentence inclined changing louder poured
slightest subjects impatient tones list collar accident pen fierce foreign gates fill probable
silly trade trace prevented amazement steward absorbed frowned intent fountain cole git manage
wept elegant chimney pleasing startled accounts quarrel custom parlour produce steel comrade
grasp substance shudder ringing interval descended lucky fled card active column grounds doubts
blessing intently sinking reference lifting awaiting sleepy solid smallest sternly relieved
calmly dropping hearted library page cloth steadily civility carpenter hitherto announced grim
parting cared softened social rushing murdered shouts reported goddard wolves heap branches flat
sobs breeze observing stroke furniture skeleton seamen rear seconds dashed bodies design swiftly
fetched freely press occasions discover yield roused delivered becomes gaze vice embraced
passions tormented millions ventured hated exact resting civil stories cease beaten pillow
record qualities faithful lightly silk reports restored pole flies objection dislike valuable
summoned demand quantity corn definite tomb drops members sixty lesson ceiling terribly chose
minded meat overcome alongside contrast hunted risen saddle nations attracted smart departed
deceived concealed flag principal warmly skill waved capture weep deserve loves admired warmth
endeavour obtained sixteen interview encounter mental hunger physical spiritual earnestly brandy
wandered sang using narrative doctors amount leather named recall divided roar frequent marshes
pose pushing practical acting opinions resolute correct ignorance referred mankind outer keen
nation artillery hurrying curtain longed repeat catching executed puzzled howling proposal
examining afford pie pirates frost swinging exposed awhile heartily tobacco swung detail calls
degrees masses owing autumn attentive motive intimacy quitted essential problem keeper kinds
flames divine hell eyed heels limbs timidly violence faster butter beast hush cost sharks haste
wave support mountain whence attacked handle propose risk enjoyed unlike murderer stained
numbers crack horizon recognize glow impulse whip tools scenes likeness urged memories reserved
dined corps orderly fastened secrets chairs rows simon contents lamps rules hopeless timid
assembled absurd venture plate sell pack chains canvas admire obey awaited struggled utterly
enemies gallop perceive winds haired overboard slave solitude lowered certainty wreck decide
teach species secured century confined waking valley attendant dismal results store travel
center gloves jaws declare salt fury feeble wandering knock begins paying lid bundle eagerness
signal newly provided landed source owner bushes folly external corpse fires exquisite romantic
purse inquire regarding sleeves confident eleven inner client fitted argument fifth brass
screamed helpless waist cares examine meal cure score rights messenger sons arrange idle landing
polite victim realized suspect doubtless birth generous animation hinted assist dreaded sole
exist furnished burden convict folks wing gang wheel armies wondrous sending swimming
humble bells sideways wasted troubles seventy devils tearing muskets brows ashes price fiend
columns sunshine merit consisted apparent forming endured satisfy bride seizing rare lake beings
wrinkled funny advise ladder banks stirring ugly upset flower execution stiff purple applied
sleeve supply inform paces armchair naked dumb stooping painter instinct invisible indicated
elderly clay composure families amusement seeming shows performed mistress composed glimpse
stepping woe restless beer base merchant aide baggage slid mender inches burnt pretend anxiously
drowned rats attending sobbing rude rubbed treat spell deny childhood mingled beach stake wrist
contained actual admirable hesitated prayed reserve dimly seize happier anguish leisure vexation
properly suspended blush universal paced dam lance hoping apple hoarse whistle desk roared
follows sheep numerous ragged bars oath earlier tin tavern leaped hailed awakened fishing
seemingly method carpet bulwarks shout planks extended uncertain obliging gallant assistant
estates circles instances belonging member rod kissing shrugged corridor steal priest whaleman
monde waistcoat practice sharply wings dish introduce shaped backs uncommon pretended hastened
saving blowing steep shelter thread shaken issued continual clue pile tables cruelty stomach
shoved oak injured system musket knoll block facing safely senseless endless ghastly behold foul
accused criminal sins tolerable recommend gaily arrested ceremony reflect tranquil remote
stillness lawyer host tow pig milk eaten violently fright guessed swim corners haunted pitch
swaying debts rocks flash blank anchor relate helm lowering statement bestowed stretch knives
recent variety chances artist thereby capacity assume jealous confirmed conveyed audience
sincerely deceive keys wretch sweep pacing mustache battalion smaller theirs waste arguments
spreading visits released strangers veil commands swore audible appeal volume spoiled depended
pork oar twisted completed nodding gallery stores dense skull caution peril articles passenger
guide doubted realize creation ages awe tenderly market entreat elsewhere writes income
recollect religion unseen lunch political lean hospital veins depths vicomte icon sunrise
peoples lessons largest animals finds upright waving learning checked bowing blew verses pursue
folk pirate pin weapon disgrace terrors string behaved recover aroused keeps betrayed easier foe
peaceful wot torture tragedy quality nerves grieved gratified conceive desirable expense
envelope joyfully principle remorse inquiring hears welfare yielded searching plump majestic
fashioned control maids stricken decision ballroom intense saber crowds pine dried goose judging
star branch rubbing scream win counting stolen globe stockade horrors bodily increase cursed
trifle fore jealousy anyhow prayers trunk union exchanged rays avoided prolonged glances
gigantic female coldly dresses advised flow secrecy pleasures regularly ascended restrain waiter
file linen eighteen devotion hay centuries whiteness nowhere crazy elbows deserved pot likes
mouths boldly barrel guest owe clung sober galloping date offering phrase openly process washed
clearing supplied sunlight spared improved term wit check perform sentiment suspense farewell
winding obtain hatred packed destiny customary dusty chambers villages image wagons marble cal
sleigh learnt blown presents shrill vulgar sorrowful neat swallowed decidedly changes whistling
depends wildly shark guilt rattle harder pursuing thankful brief entry addition schooner
respects thither trusted rejoined dug prefer sore whereas stooped existed basket crushed floated
cellar serving careless bitterly retorted sweat impressed preserve studied passages rational
selfish tolerably replying amazed induced contented shoe privilege wonders reasoning trousers
restore hum brightly fin favorite flashed swallow grant wash disgust sugar feather holiday
attempted clasped cattle author frown keel rigging plunged readiness desert aft painfully
adopted rags popular effects amusing screen declined render remove alter blushing deprived arise
pavement sincere emotions condemned essence inferior placing prey virtues boot spectacle
dragging frightful weeping cab shuddered gods hounds adjutants tumbling doorway panting tie
whoever breathe afore settling bite involved islands romance terrified crimes scoundrel weaker
mourning foremost mount gathering drag avenue brings bulk respected agin boom childish echoes
quest pausing snatched submit envy skiff horribly consult grain lighting thumb feature possess
incapable bred etc approve suited mode wives created assented apartment grandeur claims esteem
succeed momentary derived earthly traces faded career accord surprize swayed ridden jet wagon
lack rosy historic flukes overhead rat poison footmen secondly tossing denied furious retire
pencil mischief runs seaman mail shipmates arranging error pipes confessed occupy title rapidity
perished sheets snake rusty bits cheese chapel labour cracked hoisted angle chill foam mirror
tent covering hull guided keenly brains approval afforded motives fantastic formal type vexed
musical militia symptoms stationed assisted gravity falls article drooping depth emerged barrier
brute ribbon watchman counsel inch operation anteroom che blubber pink muttering belongs bend
tiptoe graceful steam appearing spoon tremble wig attempts sorrows nails joining split medicine
blamed fools map astern benefit youngest pound exception cheer swell destined liberal shooting
flattered gaining colours relieve hail welcomed discuss bullets shoot disturb pilot sixth curse
fed hunters incident intellect heroes healthy purchase treatment guarded felicity totally
interfere preceding eyeing deemed repose region hey precise slender disorder blast strained doom
joyous harness nowadays wars regiments marching sire steamboat picking beds shiver whispers
coward subdued sob trot marched signed dreaming gather lingering shivering briskly heaving trick
harbour hearty innocence desires dreary portion counter heave bleeding abandon wrought summit
holes quivering included vile stump radiant backward unite induce refusal counted visiting
withdrew bestow intending announce poverty conducted oppressed theatre massive goods wisdom
shawl rarely agent nobility porter metal fiery blazing wrinkles toil sung gale honey bees
specially uniforms mob borzois fishermen killing severely cake quicker knocking curled stool
answers toes dreamed shared handy residence fancies plank heel defend compass unwilling punch
crutch suitable scarce spending security stove groan solemnity masts weapons perish pit melted
dwelling injury hurst educated acquired speaks imaginary studying bears shops prevailed
determine alliance hints sly honoured local discussed vivid wax watery churches vessels measured
asks harsh caps machine telegram leader jest hump battles owners waked hammock whiskers curly
knot insult hearth paint unjust velvet tempered neighbour reduced speaker dismay threshold
shocked palm backed hoofs despised rings wiping outward casting daring shots fourteen helping
upwards flowed staggered nostrils piled greatness presume scarlet invite bonnet mutual resist
rejoiced enjoying apply flowing renewed walks accompany arriving carved supported retained
depressed travelled tradesman refuge hook drifting clutched strict runaway bloom tread wiped
shutters crush sublime equality defeat elements escort brighter glided surprized standard groups
favor halted blanket harpoons cats swam washing politely failure shy peering tumbled
jumping mournful brush bursting worried downwards push fits motioned basin prospects dusk
require begging justified remind bustle latest hanged weighed willingly lighter curiously
leeward rejoice glowing soil smoked feverish coats drunken preferred combined inspired recently
coolly apology leaf quivered displayed trivial parish chaise trifling exertion sweetness
tendency fearing suggest avoiding complain firmness worldly neglected defined lawn halloa beard
lunatic chased descried pressure lungs reign replaced purity campfires ole peeped submitted
choked sighing growled pet bark deepest bother doubtful belt pictured stare district beggar
frozen slope balance descend towns anchorage clumsy chart copy spade including vividly hither
desolate bags load range retreated logs wounds perils shove longing boiling charged groaned
barrels refrain accent affect fatigue critical cough kingdom entitled solely polished opposed
elegance poetry convey malice believing cents valued relative governess finest terrific services
duel errand vicinity apron commit needle dispersed moves knitted youthful vainly groom protect
inspector vital erect limit gleamed entrusted thyself ferry mariners orange tiny improve
soothing prize tales crash yer rattling guinea crawled plates arrow ambition permitted decline
tramp lined nod traveller regretted bid yielding hark delayed breathed neglect murmur shallow
kneeling talent conclude disguise syllable mixture earliest cautious injustice employ tedious
faults approved behave disdain convince transport measures blinds rob fruit test spiders frock
embrace brick sparkling stable frantic lifeless invested undertake witnesses based twilight
disease dashing carries worship coronet wealthy scar icons corporal ghosts stockings fan lap
clinging dripping denial slate worry nest irons roses painting crimson pattern finishing
squeezed tails buttons tremulous blade allowing brushed biscuit raging dismissed pages merits
offence
`.trim().split(/\s+/);
