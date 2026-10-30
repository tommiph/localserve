package org.sormus.downloads;
import java.util.ArrayDeque;import java.util.LinkedHashSet;
/** Bounded in-process FIFO. Completed/cancelled batches are not redelivered. */
final class TransferInbox<T> {
 private final int capacity;private final ArrayDeque<T> queue=new ArrayDeque<>();private final LinkedHashSet<String> seen=new LinkedHashSet<>();
 TransferInbox(int capacity){this.capacity=capacity;}
 synchronized boolean offer(String id,T value){if(seen.contains(id)||queue.size()>=capacity)return false;seen.add(id);while(seen.size()>128)seen.remove(seen.iterator().next());queue.addLast(value);return true;}
 synchronized boolean seen(String id){return seen.contains(id);}synchronized T poll(){return queue.pollFirst();}synchronized boolean isEmpty(){return queue.isEmpty();}synchronized void clear(){queue.clear();}
 static boolean external(String action){return "android.intent.action.SEND".equals(action)||"android.intent.action.SEND_MULTIPLE".equals(action)||"android.intent.action.VIEW".equals(action);}
}
