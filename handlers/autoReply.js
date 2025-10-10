import { webhookQueue } from "../queues/webhookQueue.js";
import  Subscription  from "../models/Subscription.js";


const MAKE_WEBHOOK_CALL = async(meta) => {
  const {body, instanceId , phone } = meta;
    try {
       console.log(phone) 
      if(!body) return;
      const subscription = await Subscription.findOne(
       { userId: instanceId.split('_')[1], plan_type: "open" },
    );
      console.log(subscription.webhookUrl)
      if (subscription && subscription.webhookUrl) {
        console.log('before adding')
        await webhookQueue.add("sendWebhook", {
          url: subscription.webhookUrl ,
          payload: {
            phone : `+${phone}`,
            message: body,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      console.error("autoReply error", err);
    }
};

export default MAKE_WEBHOOK_CALL;
