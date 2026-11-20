export type MediaKind = "audio" | "video";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  artist: string;
  src: string;
  thumbnail: string;
}

const cover = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=720&h=720`;

export const MEDIA: MediaItem[] = [
  {
    id: "helix-01",
    kind: "audio",
    title: "Song 1",
    artist: "SoundHelix",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    thumbnail: cover(9656150),
  },
  {
    id: "mixing-colors",
    kind: "video",
    title: "The Art of Mixing Colors",
    artist: "StefWithAnF",
    src: "https://videos.pexels.com/video-files/4003943/4003943-sd_960_540_25fps.mp4",
    thumbnail:
      "https://images.pexels.com/videos/4003943/pexels-photo-4003943.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=540&w=960",
  },
  {
    id: "helix-03",
    kind: "audio",
    title: "Song 3",
    artist: "SoundHelix",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    thumbnail: cover(10022926),
  },
  {
    id: "aerial-waves",
    kind: "video",
    title: "Aerial View of Waves",
    artist: "Nadezhda Moryak",
    src: "https://videos.pexels.com/video-files/9806390/9806390-sd_960_540_25fps.mp4",
    thumbnail:
      "https://images.pexels.com/videos/9806390/pexels-photo-9806390.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=540&w=960",
  },
  {
    id: "helix-08",
    kind: "audio",
    title: "Song 8",
    artist: "SoundHelix",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    thumbnail: cover(9656152),
  },
  {
    id: "slow-motion-colours",
    kind: "video",
    title: "Slow Motion Colours",
    artist: "StefWithAnF",
    src: "https://videos.pexels.com/video-files/3947196/3947196-sd_960_540_25fps.mp4",
    thumbnail:
      "https://images.pexels.com/videos/3947196/abstract-colours-experimental-macro-3947196.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=540&w=960",
  },
  {
    id: "helix-13",
    kind: "audio",
    title: "Song 13",
    artist: "SoundHelix",
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3",
    thumbnail: cover(9977648),
  },
  {
    id: "liquid-paints",
    kind: "video",
    title: "Liquid Paints and Spheres",
    artist: "StefWithAnF",
    src: "https://videos.pexels.com/video-files/3582429/3582429-sd_960_540_24fps.mp4",
    thumbnail:
      "https://images.pexels.com/videos/3582429/free-video-3582429.jpg?auto=compress&cs=tinysrgb&fit=crop&h=540&w=960",
  },
];

const BY_ID = new Map(MEDIA.map((item) => [item.id, item]));

export function getMedia(id: string | null | undefined): MediaItem | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function adjacentMedia(id: string | null, step: 1 | -1): MediaItem {
  const index = MEDIA.findIndex((item) => item.id === id);
  if (index === -1) return MEDIA[0];
  return MEDIA[(index + step + MEDIA.length) % MEDIA.length];
}
