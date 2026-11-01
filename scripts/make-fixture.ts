import fs from "node:fs";
const src = JSON.parse(fs.readFileSync(process.argv[2] ?? `${process.env.HOME}/x-nalenz-data/timeline-2026-11-01.json`, "utf8"));
const OWNER = "1852658982608846848";
const wantIds = new Set<string>();
const pick = (pred: (t: any) => boolean, n: number) => src.tweets.filter(pred).slice(0, n).forEach((t: any) => wantIds.add(t.id));
pick((t) => !t.referenced_tweets && !t.attachments && !t.entities?.urls, 4);                 // text
pick((t) => !t.referenced_tweets && t.entities?.urls?.some((u: any) => u.title), 4);          // titled link
pick((t) => !t.referenced_tweets && t.entities?.urls?.length && !t.entities.urls.some((u: any) => u.title) && !t.attachments, 3); // untitled link
pick((t) => t.attachments?.media_keys && !t.referenced_tweets, 3);                             // media
pick((t) => t.referenced_tweets?.[0]?.type === "replied_to" && t.in_reply_to_user_id === OWNER, 3); // self reply
pick((t) => t.referenced_tweets?.[0]?.type === "replied_to" && t.in_reply_to_user_id !== OWNER, 3); // reply to other
pick((t) => t.referenced_tweets?.[0]?.type === "retweeted", 2);
pick((t) => t.referenced_tweets?.[0]?.type === "quoted", 1);
pick((t) => t.note_tweet, 2);
wantIds.add("2115703316281778260"); // the research question post
const data = src.tweets.filter((t: any) => wantIds.has(t.id));
const keys = new Set(data.flatMap((t: any) => t.attachments?.media_keys ?? []));
const media = src.includes.media.filter((m: any) => keys.has(m.media_key));
fs.writeFileSync("tests/fixtures/timeline-sample.json", JSON.stringify({ data, includes: { media } }, null, 1));
console.log(data.length, "tweets", media.length, "media");
