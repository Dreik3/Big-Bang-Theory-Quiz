const PHOTO_LICENSE = {
  name: "CC BY 2.0",
  url: "https://creativecommons.org/licenses/by/2.0/",
};

const BACKGROUNDS = {
  apartment: {
    src: "assets/backgrounds/apartment.jpg",
    label: "Квартира Леонарда и Шелдона",
    title: "Big Bang Theory set",
    author: "NASA Blueshift",
    authorUrl: "https://www.flickr.com/people/50306086@N07",
    source: "https://commons.wikimedia.org/w/index.php?curid=11914986",
    position: "50% 70%",
    topics: ["apartment", "friends", "family", "cafe", "video", "contract", "music", "pets", "wedding", "food", "flags"],
  },
  hallway: {
    src: "assets/backgrounds/hallway.jpg",
    label: "Коридор квартир",
    title: "The Big Bang Theory, Hallway (6196388577)",
    author: "Chester",
    authorUrl: "https://www.flickr.com/people/91032493@N00",
    source: "https://commons.wikimedia.org/w/index.php?curid=33151058",
    position: "50% 52%",
    topics: ["door", "city", "travel", "train"],
  },
  comics: {
    src: "assets/backgrounds/comics.jpg",
    label: "Магазин комиксов Стюарта",
    title: 'The Big Bang Theory, Comic Book Store "The Comic Center of Pasadena" (6196384919)',
    author: "Chester",
    authorUrl: "https://www.flickr.com/people/91032493@N00",
    source: "https://commons.wikimedia.org/w/index.php?curid=33151057",
    position: "50% 50%",
    topics: ["comics", "games", "cinema", "clothing"],
  },
  office: {
    src: "assets/backgrounds/office.jpg",
    label: "Кабинет в университете",
    title: "The Big Bang Theory, Office (6196901774)",
    author: "Chester",
    authorUrl: "https://www.flickr.com/people/91032493@N00",
    source: "https://commons.wikimedia.org/w/index.php?curid=33151054",
    position: "50% 55%",
    topics: ["university", "space", "award"],
  },
  whiteboard: {
    src: "assets/backgrounds/whiteboard.jpg",
    label: "Научный уголок квартиры 4A",
    title: "The Big Bang Theory, Apartment 4A, Whiteboard (5029604535)",
    author: "NASA Blueshift",
    authorUrl: "https://www.flickr.com/people/50306086@N07",
    source: "https://commons.wikimedia.org/w/index.php?curid=33151484",
    position: "50% 48%",
    topics: ["lab", "robot"],
  },
};

const BACKGROUND_BY_TOPIC = Object.fromEntries(
  Object.values(BACKGROUNDS).flatMap((background) =>
    background.topics.map((topic) => [topic, background])),
);
