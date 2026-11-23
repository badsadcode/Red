// lore.js — every readable thing in the game.
//
// Design doc §9: the truth unfolds through architecture, records and consequences,
// never exposition. These notes raise questions. They answer very few. Keep it so.
// `rooms` lists BadLevel room programs a note prefers to be found in.

export const NOTES = {
  // --- surface ---------------------------------------------------------------------
  welcome: {
    title: 'Note on the fridge',
    text: `Welcome to the lake house!

Firewood is stacked by the south wall, the axe is by the block. The stove draws well once it's going. Rod and tackle are yours to use, the trout bite best early or when it drizzles (so, always).

Chanterelles come up by the old logs after rain. Huckleberries on the slope behind the dock.

Please don't go poking around the old fenced road north of the lake. It's government land, been shut since before we bought the place. Just an old utility door.

Enjoy the quiet.
— M.`,
  },
  lookout: {
    title: 'Fire lookout logbook',
    text: `AUG 14 1987 — clear, light W wind. No smoke. Saw the elk herd on the far shore again.

AUG 22 1987 — overcast. 21:40 low sound from the N ridge. Felt it in the floor more than heard it. Phoned it in. Was told "seismic survey". At night?

SEP 02 1987 — drizzle. Red glow on the cloud base over the N ridge at 03:10 for maybe a minute. Not fire. No smoke at dawn. Phoned it in. Nobody called back.

SEP 03 1987 — Forest Service says this tower is being decommissioned. Effective immediately.

(the remaining pages have been torn out)`,
  },

  // --- B-1 Administration & Security --------------------------------------------------
  b1_welcome: {
    title: 'Laminated card: VISITOR BRIEFING', rooms: ['lobby', 'security', 'atrium'],
    text: `CASCADE BASIN APPLIED RESEARCH FACILITY
Visitor Briefing — Rev. 14 (1996)

• You are below Basin Ridge. Do not attempt to estimate how far.
• Your badge colour determines which freight levels you may visit. Do not ask about levels your badge does not show.
• If you hear the tone (a long low hum, rising), stop walking, close your eyes and count to sixty. It will pass.
• Report any red light to Security, wherever you see it.

Welcome. Thank you for your discretion.`,
  },
  b1_memo_badges: {
    title: 'Memo: badge reissue', rooms: ['office', 'security', 'conference'],
    text: `TO: All B-1 staff
FROM: Facilities & Security
RE: Badge reissue, Mar 1998

Effective Monday all badges will be reissued. B-7 will no longer be printed on ANY badge regardless of clearance. The freight panel will be relabelled accordingly.

Staff who previously held B-7 access: please see Dr. Okafor in Conference 2. This is not disciplinary.

Again: this is not disciplinary.`,
  },
  b1_email_dana: {
    title: 'Printed e-mail', rooms: ['office', 'conference', 'cafeteria'],
    text: `From: dana.whitlock@cbarf.internal
To: r.mendes@cbarf.internal
Date: Fri, 11 Sep 1998 16:02

Rui — do you ever think about how long the elevator takes? I timed it today. B-1 to B-6 is four minutes. That's over a kilometre at the speed it goes. The ridge is maybe 400 metres tall.

So where are we?

Also can you return my stapler.
— D`,
  },
  b1_security_log: {
    title: 'Security desk log', rooms: ['security', 'control', 'lobby'],
    text: `02:14  Tone on all levels, 40 sec. Count completed. Nothing further.
02:31  Shaft camera 6 shows freight car moving. Car is parked at B-1. Car is parked at B-1.
02:33  Camera 6 shows car at B-1. Disregard.
03:50  Ward (B-3) reports "someone in the vent" again. Sent Hollis.
04:20  Hollis has not returned.
04:22  Hollis returned. Says he was gone 2 minutes.
04:22  He was gone two hours.`,
  },
  b1_cafeteria: {
    title: 'Cafeteria noticeboard', rooms: ['cafeteria', 'atrium'],
    text: `THIS WEEK: chili Tuesday, fish fry Friday (trout from the basin lake — thank you, Rui!)

LOST: grey cardigan, Okafor's. Last seen B-3.

STAFF SOFTBALL is cancelled until the surface lot is resurfaced.

Please stop taping things over the freight panel. We know what B-7 is called. We all know.`,
  },
  b1_relay: {
    title: 'Freight power — operator notice', rooms: ['transit', 'control', 'lift'],
    text: `FREIGHT SHAFT 1 — POWER SEQUENCING

Following the event of 3/12/99 each level's freight landing is locked out at the level relay. To restore a landing, the relay on the level ABOVE must be closed by hand.

This is deliberate. Do not "fix" it.`,
  },

  // --- B-2 Commons & Residential --------------------------------------------------------
  b2_dorm: {
    title: 'Diary page', rooms: ['office', 'storage', 'conference', 'lab'],
    text: `Week 3 of the rotation. The commons are nice enough — the fake sky panels in the yard help more than I thought. They put them on a day cycle. Somebody set the sunset a bit too red and nobody's fixed it.

I dream about the lake every night. A lake I've never seen, with a cabin on it. Lights in the windows.

Marta says she has the same dream.`,
  },
  b2_poster: {
    title: 'Poster: RESIDENT WELLNESS', rooms: ['cafeteria', 'atrium', 'lobby'],
    text: `FEELING "THIN"? You're not alone!

Long rotations below the basin can cause:
• loss of time sense
• the feeling of being watched from dark doorways
• hearing your own footsteps a moment late

These are normal! Stay in lit areas. Walk with a buddy. If your buddy stops answering, do not follow them into unlit areas.

— Resident Wellness Office, B-2`,
  },
  b2_kitchen: {
    title: 'Kitchen order form', rooms: ['cafeteria', 'storage', 'supply'],
    text: `ORDER #4471 — surface supply drop
• canned beans ×200
• coffee (ground) ×40 kg
• D-cells ×600 ← AGAIN? who is using all these
• lantern mantles ×50
• rubber boots, B-6 — all sizes

Notes: Driver refuses to come past the gate after dark. Can we move the drop to noon.`,
  },
  b2_letter: {
    title: 'Unsent letter', rooms: ['office', 'conference', 'storage'],
    text: `Dear Mom,

I can't tell you what we do. I'm not sure I could even if I was allowed. We measure something. It gets louder when they lower things down to B-7, and quieter when they bring them back up. Sometimes they don't bring them back up.

The sky down here is fake but last night it went red by itself.

I'll be home at Christmas. Save me some pie.`,
  },
  b2_pa: {
    title: 'Torn PA script', rooms: ['control', 'lobby', 'transit'],
    text: `"Attention all residents. Event Seven is in progress. Please proceed calmly to the nearest freight landing. Do not use the lift on B-6. Do not use the stairs on B-7. Do not look into unlit doorways for the duration of the event. Thank you."

(handwritten underneath:) they said it seven times. the recording only has it once.`,
  },

  // --- B-3 Research Laboratories ----------------------------------------------------------
  b3_lab1: {
    title: 'Lab notebook — Dr. A. Okafor', rooms: ['lab', 'test_chamber', 'server'],
    text: `RES-114. Sample (rock core, B-7 dig face, depth unrecorded) placed in chamber 2.

At 1.4 kHz excitation the core emits light in a narrow band: 640–660 nm. Deep red. Intensity scales with the number of OBSERVERS in the room, not with input power.

Repeated with 1, 2, 4 observers. Repeated with the cameras on and nobody in the room: no emission.

The core knows when it's being watched, or we do something to it by watching. I am writing this down so I stop saying it out loud.`,
  },
  b3_lab2: {
    title: 'Incident report 98-031', rooms: ['lab', 'control', 'security'],
    text: `INCIDENT 98-031 — Test chamber, B-3

Summary: during resonance trial 9 the observation window showed the surface lake. Live, in daylight, from a vantage point that does not exist (approx. 20 m above the water, facing the old summer house). Duration 11 s.

Three witnesses. Two later described a man on the porch of the house. One described a woman. Witness 3 described "you".

Recommendation: discontinue trial series. Status: overruled.`,
  },
  b3_server: {
    title: 'Printout from a dead terminal', rooms: ['server', 'control', 'office'],
    text: `> QUERY LANTERN_EVENTS
  EV1  1971-06-02  surface glow 40s
  EV2  1979-10-19  surface glow 2m
  EV3  1987-09-02  surface glow 1m  [lookout report suppressed]
  EV4  1993-01-30  internal only
  EV5  1996-07-07  internal only, B-7 breach
  EV6  1998-11-11  surface glow 4m, two staff unaccounted
  EV7  1999-03-12  [RECORD NOT FOUND]
  EV8  ----------  [SCHEDULED]
> WHO SCHEDULED EV8
  [NO SUCH USER]`,
  },
  b3_sticky: {
    title: 'Sticky notes on a monitor', rooms: ['office', 'lab', 'conference'],
    text: `- the shades don't like the light. KEEP YOUR TORCH ON.
- they don't like noise either? (not sure)
- an axe works. don't ask how we know.
- do NOT let one follow you onto the freight car
- we are not supposed to call them shades.`,
  },
  b3_whiteboard: {
    title: 'Photo of a whiteboard', rooms: ['conference', 'lab', 'test_chamber'],
    text: `(diagram: a lake, a mountain, a vertical line going down from the mountain much farther than the drawing should allow. At the bottom, a circle labelled "L".)

  "THE BASIN IS THE LENS"
  "THE LAKE IS THE EYE"
  "WHO IS LOOKING THROUGH WHICH WAY??"

(in different handwriting:) both.`,
  },

  // --- B-4 Hydroponics & Biosciences ----------------------------------------------------
  b4_grow: {
    title: 'Grow-bay checklist', rooms: ['storage', 'lab', 'supply', 'courtyard'],
    text: `GROW BAY 3 — daily
☑ lights on cycle (06:00 / 20:00)
☑ pumps 1, 2
☐ pump 3 (flooded — see work order)
☑ check moss beds for "the red stuff"
☐ burn the red stuff

The basin moss grows twice as fast down here as on the surface. Nobody can explain why. It grows towards the freight shaft. Nobody can explain that either.`,
  },
  b4_fish: {
    title: 'Biology note', rooms: ['lab', 'storage', 'office'],
    text: `Trout specimens from the surface lake, sampled monthly since 1972. After each Lantern event a small fraction of the catch (~1 in 40) is unpigmented. Pale. Faintly luminous at night.

They taste the same. Rui has eaten several.

Rui reports vivid dreams of a staircase.`,
  },
  b4_water: {
    title: 'Work order 2210 (flooding)', rooms: ['storage', 'supply', 'lab'],
    text: `Flooding in the south beds again. Water is coming UP through the floor drains, not down. Tested: it's lake water. Fresh, cold, with algae from the basin.

There is 400+ m of granite between this level and the lake.

Pumping out. Again.`,
  },
  b4_cardigan: {
    title: 'Note pinned to a grey cardigan', rooms: ['storage', 'office', 'cafeteria'],
    text: `Found this in grow bay 1 after the tone. It's Ayo's. She was last seen on B-3 four hours earlier, three levels up, and the freight car was locked out.

The cardigan was wet. Lake water again.`,
  },

  // --- B-5 Power & Reactor ------------------------------------------------------------
  b5_ops: {
    title: 'Reactor operator handbook (excerpt)', rooms: ['control', 'arena', 'storage'],
    text: `§4.2  The basin load.
The plant supplies the facility AND a separate feeder ("BASIN LOAD") routed to B-7. The basin load is not metered. Do not attempt to meter it.

§4.3  When the basin load spikes, the plant output drops even though the core runs hotter. Energy is going somewhere. The current working theory is "down".`,
  },
  b5_graffiti: {
    title: 'Scrawled on a control desk', rooms: ['control', 'storage', 'supply'],
    text: `IT ISN'T A WEAPON
IT ISN'T A DOOR
IT'S A LIGHT
SOMEONE LIT IT FOR SOMEONE TO SEE BY
AND WE KEEP STANDING IN FRONT OF IT`,
  },
  b5_shift: {
    title: 'Shift handover', rooms: ['control', 'office', 'storage'],
    text: `Night shift → Day shift, 12 Mar 1999

Basin load climbing all night. Okafor went down to B-7 at 01:00 to "talk to it". Her words.

Tone at 03:10. The klaxon in the turbine hall went off by itself and is still going as I write this.

If you're reading this and it's still 12 March, get to the freight car.`,
  },
  b5_pipe: {
    title: 'Maintenance tag', rooms: ['storage', 'supply', 'control'],
    text: `PIPE RUN 14 — DO NOT INSULATE.
Frost forms on this run when the basin load is high, in a room that is 40°C.
Frost pattern resembles a map of the surface lake. Photographed weekly. See binder 9.`,
  },

  // --- B-6 Flooded Maintenance -----------------------------------------------------------
  b6_pump: {
    title: 'Pump station log', rooms: ['storage', 'control', 'supply'],
    text: `Level B-6 is below the water table of nothing. There is no water table this deep.
And yet: 3 cm/day of rise, every day, since Event 6.

The water is 4°C. It contains trout fry.`,
  },
  b6_hollis: {
    title: 'Note in a waterproof bag', rooms: ['storage', 'supply', 'secret', 'combat'],
    text: `This is Hollis, security. If anyone finds this — I followed the sound down past B-6 on the old maintenance stair. The stair goes on longer than it should. There are carvings at the bottom. Older than the facility. Older than the ridge, I'd say, if that makes sense.

They didn't dig B-7. They found it.

I'm going back up now.`,
  },
  b6_okafor: {
    title: 'Recorder transcript (water damaged)', rooms: ['control', 'storage', 'combat'],
    text: `OKAFOR: ...tape running. B-7, 01:40. The lantern is — I'm calling it that, everyone does — it's warm. Humming. The red is coming from inside the stone, not the surface.

OKAFOR: I think it's an answer. I think every event is an answer, and we never asked a question. Or someone up there did.

OKAFOR: There's a cabin on the lake, isn't there. With the lights on.

[tone] [12 seconds of water noise] [end of tape]`,
  },

  // --- B-7 ------------------------------------------------------------------------
  b7_carving: {
    title: 'Rubbing of a carving', rooms: ['shrine', 'crypt', 'library', 'great hall'],
    text: `(charcoal rubbing on facility paper, pinned to the stone)

The carving shows a valley. A lake. A mountain. A line of people carrying small lights descending inside the mountain. At the bottom: a great light, drawn as a ring.

Above the valley, the sky is shaded in. Someone has written next to it, in pencil: "red?"`,
  },
  b7_survey: {
    title: 'Survey notebook', rooms: ['library', 'vault', 'cells', 'guardroom'],
    text: `Dig face 3. The passages are cut, not natural. Tool marks consistent with bronze, or something softer than steel. Carbon dating on the soot from the torch niches: inconsistent. Two samples from the same niche: 9,000 years and "next year".

Request for further dating denied.`,
  },
  b7_last: {
    title: 'Final page, Dr. A. Okafor', rooms: ['vault', 'shrine', 'great hall', 'stair down'],
    text: `It is a lantern. Something lit it, long ago, so that someone could find the way down. Every time it flares the sky above the basin turns red, and someone on the surface looks up.

That's all it wants. Someone to look up. Someone to come down.

I don't think it's dangerous. I think the dark around it is.

If you came because of the red sky: thank you for coming. Go home now. Go home and cook something and sleep. It will still be here.`,
  },

  // --- the lantern ------------------------------------------------------------------
  lantern: {
    title: 'Carved into the base of the ring',
    text: `(the letters are not any alphabet you know, but you can read them anyway)

YOU SAW THE LIGHT
YOU CAME DOWN
NOW YOU KNOW THE WAY

GO HOME
THE LAKE WILL BE THERE
THE LIGHT WILL BE HERE

SOME DAYS YOU FISH
SOME DAYS YOU DESCEND`,
  },
};

// Which notes appear in which sector (in placement priority order).
export const SECTOR_NOTES = {
  b1: ['b1_welcome', 'b1_security_log', 'b1_memo_badges', 'b1_email_dana', 'b1_cafeteria', 'b1_relay'],
  b2: ['b2_poster', 'b2_dorm', 'b2_kitchen', 'b2_letter', 'b2_pa'],
  b3: ['b3_lab1', 'b3_lab2', 'b3_server', 'b3_sticky', 'b3_whiteboard'],
  b4: ['b4_grow', 'b4_fish', 'b4_water', 'b4_cardigan'],
  b5: ['b5_ops', 'b5_shift', 'b5_graffiti', 'b5_pipe'],
  b6: ['b6_pump', 'b6_hollis', 'b6_okafor'],
  b7: ['b7_carving', 'b7_survey', 'b7_last'],
};

// Radio: weather + something else after the red sky.
export const RADIO = {
  normal: [
    'KBSN weather: low clouds, patchy drizzle through the afternoon, highs near 58. Fog on the lakes overnight.',
    '...and that was the Valley Strings. Coming up after the news, the fishing report: trout are biting at dawn on the basin lakes...',
    'KBSN weather: showers likely, then a chance of sunbreaks late. Winds light and variable. A nice evening for a fire.',
  ],
  after: [
    '...reports of unusual lights over Basin Ridge last evening. The Forest Service says there is no cause for concern...',
    '(static) ...four. Seven. Seven. One. Four... (a slow tone, rising) ...seven...',
    '(static, then a woman\'s voice, very calm) ...if you can hear this you are close. Bring a light. Bring two.',
    'KBSN weather: drizzle, then clearing. Overnight, a chance of red skies over the ridge. (the announcer stops, as if re-reading the line) ...pardon me.',
  ],
};
