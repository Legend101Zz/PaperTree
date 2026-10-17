/**
 * lib/api/topics — the topics routes of #193 (`routers/topics.py`): the person's own shelves and
 * each paper's place under them. A suggestion never shelves a paper; only `accept` does. The shapes
 * are held to `contracts/api/topics.schema.json` by `test/contracts.spec.ts`.
 */
import { request } from './client';

const seg = encodeURIComponent;

/** The six cloths of DESIGN.md §2 (`papertree_db.CLOTHS`). */
export type Cloth = 'transformers' | 'vision' | 'generative' | 'optimization' | 'language' | 'rl';

/** Where an offer, or an accepted topic, came from. */
export type TopicSource = 'arxiv_category' | 'manual' | 'model';

/** A topic as another record points at it. */
export interface TopicRef {
  topic_id: string;
  name: string;
  cloth: Cloth | null;
}

/** `GET /topics`: a shelf with what it holds. Counts cover ACCEPTED papers only. */
export interface Topic extends TopicRef {
  sort_order: number;
  paper_count: number;
  page_count: number;
  /** The distinct arXiv categories of the held papers, sorted. */
  categories: string[];
}

/**
 * Where one paper sits (`GET /papers/{id}/topic` and the body of its writes). `suggested` is an
 * offer (`topic`, or `suggested_name` for a topic that does not exist yet): NOT shelved.
 */
export interface PaperTopic {
  status: 'none' | 'suggested' | 'accepted' | 'rejected';
  topic: TopicRef | null;
  suggested_name: string | null;
  source: TopicSource | null;
  source_detail: string | null;
  arxiv_category: string | null;
}

/** `POST /topics`. */
export interface CreateTopicBody {
  readonly name: string;
  readonly cloth?: Cloth;
}

/** `PATCH /topics/{id}`: only what is sent changes. */
export interface PatchTopicBody {
  readonly name?: string;
  /** `null` clears the colour; left out, it is kept. */
  readonly cloth?: Cloth | null;
  readonly sort_order?: number;
}

/** `PUT /papers/{id}/topic`: exactly one of `topic_id` and `new_topic_name`. */
export interface AcceptTopicBody {
  readonly topic_id?: string;
  readonly new_topic_name?: string;
  readonly cloth?: Cloth;
}

const json = (body: unknown): string => JSON.stringify(body);

/** The topics routes, one function per route; every call carries the session's bearer token. */
export const topicsApi = {
  /** The person's topics in shelf order, with counts. */
  list: () => request<Topic[]>('/topics'),
  /** 201; 409 `topic_exists` for a name already used (any letter case). */
  create: (body: CreateTopicBody) =>
    request<Topic>('/topics', { method: 'POST', body: json(body) }),
  patch: (topicId: string, body: PatchTopicBody) =>
    request<Topic>(`/topics/${seg(topicId)}`, { method: 'PATCH', body: json(body) }),
  /** 204. Its papers become unshelved; the papers themselves stay. */
  remove: (topicId: string) => request<void>(`/topics/${seg(topicId)}`, { method: 'DELETE' }),
  /** Where the paper sits; the first read stores an offer when the rule has one. */
  ofPaper: (paperId: string) => request<PaperTopic>(`/papers/${seg(paperId)}/topic`),
  /** Shelves the paper: the offer kept as its source ("you accepted"), any other choice manual. */
  accept: (paperId: string, body: AcceptTopicBody) =>
    request<PaperTopic>(`/papers/${seg(paperId)}/topic`, { method: 'PUT', body: json(body) }),
  /** "Not this": the offer is never made again for this paper. */
  reject: (paperId: string) =>
    request<PaperTopic>(`/papers/${seg(paperId)}/topic/reject`, { method: 'POST' }),
};
